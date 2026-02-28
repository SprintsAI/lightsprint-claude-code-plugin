/**
 * Maps Lightsprint project statuses to Claude Code task statuses.
 *
 * Claude Code: pending → in_progress → completed (+ deleted)
 * Lightsprint: todo → in_progress → in_review → done
 */

const LS_TO_CC = {
	'todo': 'pending',
	'in_progress': 'in_progress',
	'in_review': 'in_progress',
	'done': 'completed'
};

/**
 * Map a Lightsprint projectStatus to a Claude Code status.
 * @param {string} lsStatus
 * @returns {string | undefined}
 */
export function lsToCcStatus(lsStatus) {
	return LS_TO_CC[lsStatus];
}
