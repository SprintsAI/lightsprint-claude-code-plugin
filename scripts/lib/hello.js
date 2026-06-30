/**
 * Hello-world greeting helper for Lightsprint CLI.
 *
 * A small, self-contained utility used as an end-to-end smoke test of the
 * task → branch → PR pipeline. Follows the same input-hardening conventions
 * as the other helpers in this directory.
 */

const MAX_NAME_LENGTH = 200;

/**
 * Build a friendly greeting.
 *
 * Trims surrounding whitespace and falls back to "world" when no name is
 * given. Rejects non-string names, control characters, and overly long input
 * so a hallucinated argument can never produce a malformed payload.
 *
 * @param {string} [name='world'] - The name to greet
 * @returns {string} The greeting, e.g. "Hello, world!"
 */
export function hello(name = 'world') {
	if (typeof name !== 'string') {
		throw new Error('Name must be a string.');
	}
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\x7f]/.test(name)) {
		throw new Error('Name must not contain control characters.');
	}
	if (name.length > MAX_NAME_LENGTH) {
		throw new Error(`Name exceeds maximum length of ${MAX_NAME_LENGTH}.`);
	}

	const trimmed = name.trim();
	return `Hello, ${trimmed || 'world'}!`;
}
