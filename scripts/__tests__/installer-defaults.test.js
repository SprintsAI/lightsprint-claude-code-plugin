import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dir, '../..');
const APP_BASE_URL = 'https://app.lightsprint.ai';

describe('installer base URL defaults', () => {
	test('Unix installer persists the app host by default', () => {
		const installer = readFileSync(join(REPO_ROOT, 'install.sh'), 'utf-8');

		expect(installer).toContain('LIGHTSPRINT_BASE_URL="${LIGHTSPRINT_BASE_URL:-' + APP_BASE_URL + '}"');
		expect(installer).toContain(`if [[ "$LIGHTSPRINT_BASE_URL" != "${APP_BASE_URL}" ]]; then`);
	});

	test('Windows installer persists the app host by default', () => {
		const installer = readFileSync(join(REPO_ROOT, 'scripts/install.ps1'), 'utf-8');

		expect(installer).toContain(`$BaseUrl = "${APP_BASE_URL}"`);
		expect(installer).toContain(`if ($BaseUrl -ne "${APP_BASE_URL}") {`);
	});
});
