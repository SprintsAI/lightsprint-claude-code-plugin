/**
 * Maps Claude Code task statuses to Lightsprint project statuses and vice versa.
 *
 * Claude Code: pending → in_progress → completed (+ deleted)
 * Lightsprint: todo → in_progress → in_review → done
 */

const CC_TO_LS = {
	'pending': 'todo',
	'in_progress': 'in_progress',
	'completed': 'done'
};

const LS_TO_CC = {
	'todo': 'pending',
	'in_progress': 'in_progress',
	'in_review': 'in_progress',
	'done': 'completed'
};

/**
 * Map a Claude Code status to a Lightsprint projectStatus.
 * @param {string} ccStatus
 * @returns {string | undefined}
 */
export function ccToLsStatus(ccStatus) {
	return CC_TO_LS[ccStatus];
}

/**
 * Map a Lightsprint projectStatus to a Claude Code status.
 * @param {string} lsStatus
 * @returns {string | undefined}
 */
export function lsToCcStatus(lsStatus) {
	return LS_TO_CC[lsStatus];
}
