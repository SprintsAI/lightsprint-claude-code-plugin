/**
 * Active plan tracker for Lightsprint plugin.
 * Stored in ~/.lightsprint/active-plan.json.
 * Uses atomic writes (write tmp + rename) for safety.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const ACTIVE_FILE = join(homedir(), '.lightsprint', 'active-plan.json');

function ensureDir() {
	const dir = dirname(ACTIVE_FILE);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Set the active plan being reviewed.
 * @param {string} planId
 * @param {string} projectId
 * @param {string} sessionId
 */
export function setActivePlan(planId, projectId, sessionId) {
	ensureDir();
	const tmp = ACTIVE_FILE + '.' + randomBytes(4).toString('hex');
	writeFileSync(tmp, JSON.stringify({ planId, projectId, sessionId, updatedAt: new Date().toISOString() }));
	renameSync(tmp, ACTIVE_FILE);
}

/**
 * Get the active plan.
 * @returns {{ planId: string, projectId: string } | undefined}
 */
export function getActivePlan() {
	try {
		if (existsSync(ACTIVE_FILE)) {
			const data = JSON.parse(readFileSync(ACTIVE_FILE, 'utf-8'));
			if (data.planId && data.projectId) {
				return { planId: data.planId, projectId: data.projectId, sessionId: data.sessionId };
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
