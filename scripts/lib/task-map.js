/**
 * Task ID mapping: Claude Code task IDs ↔ Lightsprint task IDs.
 * Stored in ~/.lightsprint/task-map.json.
 * Keys are session-scoped: "{ccSessionId}:{ccTaskId}" to avoid collisions.
 * Uses atomic writes (write tmp + rename) for safety.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const MAP_FILE = join(homedir(), '.lightsprint', 'task-map.json');

function ensureDir() {
	const dir = dirname(MAP_FILE);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function readMap() {
	try {
		if (existsSync(MAP_FILE)) {
			return JSON.parse(readFileSync(MAP_FILE, 'utf-8'));
		}
	} catch {
		// Corrupted file, start fresh
	}
	return {};
}

function writeMap(map) {
	ensureDir();
	const tmp = MAP_FILE + '.' + randomBytes(4).toString('hex');
	writeFileSync(tmp, JSON.stringify(map, null, 2));
	renameSync(tmp, MAP_FILE);
}

function makeKey(ccSessionId, ccTaskId) {
	return `${ccSessionId}:${ccTaskId}`;
}

/**
 * Store a mapping from CC task ID to LS task ID, scoped by session.
 * @param {string} ccSessionId
 * @param {string} ccTaskId
 * @param {string} lsTaskId
 */
export function setMapping(ccSessionId, ccTaskId, lsTaskId) {
	const map = readMap();
	map[makeKey(ccSessionId, ccTaskId)] = lsTaskId;
	writeMap(map);
}

/**
 * Look up the LS task ID for a CC task.
 * @param {string} ccSessionId
 * @param {string} ccTaskId
 * @returns {string | null}
 */
export function getMapping(ccSessionId, ccTaskId) {
	const map = readMap();
	return map[makeKey(ccSessionId, ccTaskId)] || null;
}

/**
 * Remove all mappings for a given CC session.
 * Called on session shutdown to prevent stale entries.
 * @param {string} ccSessionId
 */
export function removeSessionMappings(ccSessionId) {
	const map = readMap();
	const prefix = `${ccSessionId}:`;
	let changed = false;
	for (const key of Object.keys(map)) {
		if (key.startsWith(prefix)) {
			delete map[key];
			changed = true;
		}
	}
	if (changed) writeMap(map);
}
