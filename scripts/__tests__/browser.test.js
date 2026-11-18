import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { canOpenBrowser, isSshSession, openBrowser } from '../lib/browser.js';

describe('canOpenBrowser', () => {
	test('linux with no display server cannot open a browser', () => {
		expect(canOpenBrowser({}, 'linux')).toBe(false);
		expect(canOpenBrowser({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' }, 'linux')).toBe(false);
	});

	test('linux with X11 or Wayland can open a browser', () => {
		expect(canOpenBrowser({ DISPLAY: ':0' }, 'linux')).toBe(true);
		expect(canOpenBrowser({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(true);
	});

	test('linux over ssh -X still opens through the forwarded display', () => {
		expect(canOpenBrowser({ DISPLAY: 'localhost:10.0', SSH_CONNECTION: 'x' }, 'linux')).toBe(true);
	});

	test('macOS and Windows open locally but not over SSH', () => {
		expect(canOpenBrowser({}, 'darwin')).toBe(true);
		expect(canOpenBrowser({}, 'win32')).toBe(true);
		expect(canOpenBrowser({ SSH_CONNECTION: 'x' }, 'darwin')).toBe(false);
		expect(canOpenBrowser({ SSH_TTY: '/dev/ttys001' }, 'win32')).toBe(false);
	});
});

describe('isSshSession', () => {
	test('detects SSH_CONNECTION or SSH_TTY', () => {
		expect(isSshSession({})).toBe(false);
		expect(isSshSession({ SSH_CONNECTION: 'x' })).toBe(true);
		expect(isSshSession({ SSH_TTY: '/dev/pts/0' })).toBe(true);
	});
});

describe('openBrowser', () => {
	// Stand-in `open` / `xdg-open` that record a launch instead of opening a
	// real browser. They are first on PATH for the duration of each test.
	const keys = ['PATH', 'SSH_CONNECTION', 'SSH_TTY', 'DISPLAY', 'WAYLAND_DISPLAY', 'LIGHTSPRINT_NO_BROWSER'];
	let saved;
	let dir;
	let marker;

	beforeEach(() => {
		saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
		for (const k of keys) if (k !== 'PATH') delete process.env[k];
		dir = mkdtempSync(join(tmpdir(), 'ls-browser-'));
		marker = join(dir, 'launched');
		for (const name of ['open', 'xdg-open']) {
			const bin = join(dir, name);
			writeFileSync(bin, `#!/bin/sh\ntouch "${marker}"\n`);
			chmodSync(bin, 0o755);
		}
		process.env.PATH = `${dir}:${saved.PATH}`;
	});

	afterEach(() => {
		for (const k of keys) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
		rmSync(dir, { recursive: true, force: true });
	});

	async function launched() {
		for (let i = 0; i < 40; i++) {
			if (existsSync(marker)) return true;
			await Bun.sleep(25);
		}
		return false;
	}

	test.skipIf(process.platform === 'win32')('returns false and launches nothing when no browser can be shown', async () => {
		// An SSH session with no forwarded display: headless on Linux, and the
		// wrong machine's desktop on macOS.
		process.env.SSH_CONNECTION = '1.2.3.4 5 6.7.8.9 22';
		expect(openBrowser('https://app.lightsprint.ai/authorize-cli?port=1234')).toBe(false);
		expect(await launched()).toBe(false);
	});

	test.skipIf(process.platform === 'win32')('still launches on a local desktop session', async () => {
		if (process.platform === 'linux') process.env.DISPLAY = ':0';
		expect(openBrowser('https://app.lightsprint.ai/authorize-cli?port=1234')).toBe(true);
		expect(await launched()).toBe(true);
	});
});
