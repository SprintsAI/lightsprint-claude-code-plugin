/**
 * hello.js — Minimal "Hello, world!" smoke-test helper.
 *
 * Exposes a tiny pure `hello()` function plus a CLI entrypoint that prints its
 * output. Used to exercise the end-to-end agent → implement → test → commit →
 * push → PR pipeline with a self-contained, low-risk change.
 */

import { fileURLToPath } from 'node:url';

/**
 * Build a friendly greeting.
 * @param {string} [name] - Who to greet. Defaults to "world".
 * @returns {string}
 */
export function hello(name = 'world') {
	return `Hello, ${name}!`;
}

// CLI entrypoint: `node scripts/hello.js [name]` (also works under Bun).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	console.log(hello(process.argv[2]));
}
