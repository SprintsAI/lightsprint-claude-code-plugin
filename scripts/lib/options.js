/**
 * Global option parser for Lightsprint CLI.
 *
 * Extracts cross-cutting flags (--output, --json, --dry-run, --fields)
 * from args in a single pass, returning the remaining args for
 * command-specific parsing.
 */

const VALID_OUTPUT_FORMATS = ['json', 'text'];

/**
 * Parse global options from an args array.
 * @param {string[]} args
 * @returns {{ globalOptions: { outputFormat: 'json'|'text', dryRun: boolean, fields: string[]|null }, remainingArgs: string[] }}
 */
export function parseGlobalOptions(args) {
	let outputFormat = 'text';
	let dryRun = false;
	let fields = null;
	const remaining = [];

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--output' && args[i + 1]) {
			const fmt = args[++i];
			if (!VALID_OUTPUT_FORMATS.includes(fmt)) {
				throw new Error(`Invalid output format: "${fmt}". Allowed values: ${VALID_OUTPUT_FORMATS.join(', ')}`);
			}
			outputFormat = fmt;
		} else if (args[i] === '--json') {
			outputFormat = 'json';
		} else if (args[i] === '--dry-run') {
			dryRun = true;
		} else if (args[i] === '--fields' && args[i + 1]) {
			fields = args[++i].split(',').map(f => f.trim()).filter(Boolean);
			outputFormat = 'json'; // --fields implies JSON output
		} else {
			remaining.push(args[i]);
		}
	}

	return {
		globalOptions: { outputFormat, dryRun, fields },
		remainingArgs: remaining
	};
}
