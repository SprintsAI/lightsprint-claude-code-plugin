/**
 * Input validation helpers for Lightsprint CLI.
 *
 * Defends against agent hallucinations, path traversal, and injection attacks.
 * All validators throw on invalid input with a message naming the valid format/values.
 */

// ─── ID validation ──────────────────────────────────────────────────────

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an ID (task, plan, project) contains only safe characters.
 * Rejects path traversal, query params, and control characters.
 * @param {string} id - The ID to validate
 * @param {string} [label='ID'] - Label for error messages (e.g. 'Task ID', 'Plan ID')
 * @returns {string} The validated ID
 */
export function validateId(id, label = 'ID') {
	if (!id || typeof id !== 'string') {
		throw new Error(`${label} is required.`);
	}
	if (!ID_PATTERN.test(id)) {
		throw new Error(`Invalid ${label}: "${id}". Only alphanumeric characters, hyphens, and underscores are allowed.`);
	}
	return id;
}

// ─── Enum validation ────────────────────────────────────────────────────

export const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
export const VALID_COMPLEXITIES = ['low', 'medium', 'high'];
export const VALID_DEPS_FILTERS = ['has-dependencies', 'has-dependents', 'unblocked'];

/**
 * Validate a value against an allowed set.
 * @param {string} value - The value to validate
 * @param {string[]} allowed - Allowed values
 * @param {string} fieldName - Field name for error messages
 * @returns {string} The validated value
 */
export function validateEnum(value, allowed, fieldName) {
	if (!allowed.includes(value)) {
		throw new Error(`Invalid ${fieldName}: "${value}". Allowed values: ${allowed.join(', ')}`);
	}
	return value;
}

/**
 * Validate a task status value.
 * @param {string} status
 * @returns {string}
 */
export function validateStatus(status) {
	return validateEnum(status, VALID_STATUSES, 'status');
}

/**
 * Validate a task complexity value.
 * @param {string} complexity
 * @returns {string}
 */
export function validateComplexity(complexity) {
	return validateEnum(complexity, VALID_COMPLEXITIES, 'complexity');
}

// ─── PID validation ─────────────────────────────────────────────────────

/**
 * Validate that a PID is a positive integer string (safe for shell interpolation).
 * @param {string|number} pid
 * @returns {string} The PID as a validated string
 */
export function validatePid(pid) {
	const s = String(pid);
	if (!/^\d+$/.test(s) || s === '0') {
		throw new Error(`Invalid PID: "${pid}". Must be a positive integer.`);
	}
	return s;
}

// ─── Length validation ──────────────────────────────────────────────────

export const MAX_TITLE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 50000;
export const MAX_COMMENT_LENGTH = 10000;

/**
 * Validate string length and reject control characters (except newlines/tabs in bodies).
 * @param {string} value
 * @param {number} maxLength
 * @param {string} fieldName
 * @param {{ allowNewlines?: boolean }} [options]
 * @returns {string}
 */
export function validateLength(value, maxLength, fieldName, options = {}) {
	if (typeof value !== 'string') {
		throw new Error(`${fieldName} must be a string.`);
	}
	if (value.length > maxLength) {
		throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters (got ${value.length}).`);
	}
	// Reject control characters (allow \n, \r, \t in body fields)
	const pattern = options.allowNewlines
		? /[\x00-\x08\x0B\x0C\x0E-\x1F]/
		: /[\x00-\x1F]/;
	if (pattern.test(value)) {
		throw new Error(`${fieldName} contains invalid control characters.`);
	}
	return value;
}

/**
 * Validate a task title.
 */
export function validateTitle(title) {
	return validateLength(title, MAX_TITLE_LENGTH, 'Title');
}

/**
 * Validate a task description.
 */
export function validateDescription(description) {
	return validateLength(description, MAX_DESCRIPTION_LENGTH, 'Description', { allowNewlines: true });
}

/**
 * Validate a comment body.
 */
export function validateCommentBody(body) {
	return validateLength(body, MAX_COMMENT_LENGTH, 'Comment body', { allowNewlines: true });
}

// ─── URL validation ─────────────────────────────────────────────────────

/**
 * Validate that a base URL uses HTTPS (allows localhost/127.0.0.1 for development).
 * @param {string} url
 * @returns {string} The validated URL
 */
export function validateBaseUrl(url) {
	if (!url || typeof url !== 'string') {
		throw new Error('Base URL is required.');
	}

	try {
		const parsed = new URL(url);

		// Allow HTTP only for localhost development
		const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
		if (parsed.protocol === 'http:' && !isLocalhost) {
			throw new Error(`Base URL must use HTTPS: "${url}". HTTP is only allowed for localhost.`);
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new Error(`Base URL must use HTTP(S): "${url}".`);
		}

		return url;
	} catch (err) {
		if (err.message.includes('Base URL')) throw err;
		throw new Error(`Invalid base URL: "${url}".`);
	}
}

// ─── Version validation ─────────────────────────────────────────────────

/**
 * Validate a semver-like version string.
 * @param {string} version
 * @returns {string}
 */
export function validateVersion(version) {
	if (!/^\d+\.\d+\.\d+/.test(version)) {
		throw new Error(`Invalid version format: "${version}". Expected semver (e.g. 1.2.3).`);
	}
	if (/[\\/]|\.\./.test(version)) {
		throw new Error(`Invalid characters in version: "${version}".`);
	}
	return version;
}
