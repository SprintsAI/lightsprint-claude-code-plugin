/**
 * Task ID mapping: Claude Code task IDs ↔ Lightsprint task IDs.
 * Stored in ~/.lightsprint/task-map.json.
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

/**
 * Store a mapping from CC task ID to LS task ID.
 * @param {string} ccTaskId
 * @param {string} lsTaskId
 */
export function setMapping(ccTaskId, lsTaskId) {
	const map = readMap();
	map[ccTaskId] = lsTaskId;
	writeMap(map);
}
