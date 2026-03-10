/**
 * Maps Lightsprint project statuses ↔ Claude Code task statuses.
 *
 * Claude Code: pending → in_progress → completed (+ deleted)
 * Lightsprint: todo → in_progress → in_review → done
 */

const LS_TO_CC = {
	'backlog': 'pending',
	'todo': 'pending',
	'in_progress': 'in_progress',
	'in_review': 'in_progress',
	'done': 'completed'
};

const CC_TO_LS = {
	'pending': 'backlog',
	'in_progress': 'in_progress',
	'completed': 'done'
};

/**
 * Map a Lightsprint status to a Claude Code status.
 * @param {string} lsStatus
 * @returns {string | undefined}
 */
export function lsToCcStatus(lsStatus) {
	return LS_TO_CC[lsStatus];
}

/**
 * Map a Claude Code task status to a Lightsprint status.
 * @param {string} ccStatus
 * @returns {string | undefined}
 */
export function ccToLsStatus(ccStatus) {
	return CC_TO_LS[ccStatus];
}
