/**
 * Active plan tracker for Lightsprint plugin.
 * Stored in ~/.lightsprint/active-plan.json.
 * Uses atomic writes (write tmp + rename) for safety.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const CONFIG_DIR = process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint');
const ACTIVE_FILE = join(CONFIG_DIR, 'active-plan.json');

function ensureDir() {
	const dir = dirname(ACTIVE_FILE);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Set the active plan being reviewed.
 * @param {string} planId
 * @param {string} repoId
 * @param {string} sessionId
 */
export function setActivePlan(planId, repoId, sessionId) {
	ensureDir();
	const tmp = ACTIVE_FILE + '.' + randomBytes(4).toString('hex');
	writeFileSync(tmp, JSON.stringify({ planId, repoId, sessionId, updatedAt: new Date().toISOString() }));
	renameSync(tmp, ACTIVE_FILE);
}

/**
 * Get the active plan.
 * @returns {{ planId: string, repoId: string } | undefined}
 */
export function getActivePlan() {
	try {
		if (existsSync(ACTIVE_FILE)) {
			const data = JSON.parse(readFileSync(ACTIVE_FILE, 'utf-8'));
			if (data.planId && data.repoId) {
				return { planId: data.planId, repoId: data.repoId, sessionId: data.sessionId };
			}
		}
	} catch {
		// Corrupted file
	}
	return undefined;
}

/**
 * Clear the active plan.
 */
export function clearActivePlan() {
	try {
		if (existsSync(ACTIVE_FILE)) {
			unlinkSync(ACTIVE_FILE);
		}
	} catch {
		// Ignore
	}
}
