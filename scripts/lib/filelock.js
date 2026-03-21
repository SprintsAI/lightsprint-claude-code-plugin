/**
 * filelock.js — Simple advisory file locking for cross-process coordination.
 *
 * Uses mkdir-based locking (atomic on all platforms, no native deps).
 * The lockfile is a directory — mkdir is atomic and fails if it already exists.
 */

import { mkdirSync, rmdirSync, existsSync, statSync } from 'fs';

const DEFAULT_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 50;
const STALE_LOCK_AGE_MS = 60000; // 1 minute

/**
 * Acquire a lock, execute callback, release lock.
 * @param {string} lockPath - Path to use as lock (will be a directory)
 * @param {Function} fn - Callback to execute while holding lock
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<any>} Result of fn()
 */
export async function withFileLock(lockPath, fn, opts = {}) {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;

	// Try to acquire lock
	while (true) {
		try {
			mkdirSync(lockPath);
			break; // Lock acquired
		} catch (err) {
			if (err.code !== 'EEXIST') throw err;

			// Check for stale lock
			try {
				const stat = statSync(lockPath);
				if (Date.now() - stat.mtimeMs > STALE_LOCK_AGE_MS) {
					// Stale lock — force remove and retry
					try { rmdirSync(lockPath); } catch {}
					continue;
				}
			} catch {
				// Lock was just released — retry
				continue;
			}

			if (Date.now() >= deadline) {
				throw new Error(`Failed to acquire lock: ${lockPath} (timeout after ${timeoutMs}ms)`);
			}
			await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
		}
	}

	// Execute callback, then release lock
	try {
		return await fn();
	} finally {
		try { rmdirSync(lockPath); } catch {}
	}
}
