/**
 * Browser profile detection and URL opening utilities.
 *
 * Scans Chromium-based browsers and Firefox for profiles matching a given email,
 * then opens URLs in the matched browser profile on macOS.
 * Falls back to system default on other platforms or when no profile is detected.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

const APP_SUPPORT = join(homedir(), 'Library', 'Application Support');

/** Chromium-based browsers with compatible --profile-directory support. */
const CHROMIUM_BROWSERS = [
	{ app: 'Google Chrome', base: 'Google/Chrome' },
	{ app: 'Brave Browser', base: 'BraveSoftware/Brave-Browser' },
	{ app: 'Microsoft Edge', base: 'Microsoft Edge' },
	{ app: 'Vivaldi', base: 'Vivaldi' },
	{ app: 'Opera', base: 'com.operasoftware.Opera' },
	{ app: 'Chromium', base: 'Chromium' },
];

/**
 * Parse a Firefox profiles.ini file into a list of profile entries.
 * @param {string} iniContent - Raw contents of profiles.ini
 * @param {string} firefoxBase - Absolute path to the Firefox app support directory
 * @returns {{ name: string, absolutePath: string }[]}
 */
function parseFirefoxProfiles(iniContent, firefoxBase) {
	const profiles = [];
	let current = null;

	for (const line of iniContent.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('[Profile')) {
			current = {};
		} else if (trimmed.startsWith('[') || trimmed === '') {
			if (current?.Path) profiles.push(current);
			current = trimmed.startsWith('[') ? null : current;
		} else if (current) {
			const eq = trimmed.indexOf('=');
			if (eq > 0) {
				const key = trimmed.slice(0, eq);
				const val = trimmed.slice(eq + 1);
				if (key === 'Name') current.Name = val;
				if (key === 'Path') current.Path = val;
				if (key === 'IsRelative') current.IsRelative = val;
			}
		}
	}
	if (current?.Path) profiles.push(current);

	return profiles.map(p => ({
		name: p.Name || p.Path,
		absolutePath: p.IsRelative === '1'
			? join(firefoxBase, p.Path)
			: p.Path,
	}));
}

/**
 * Scan Chromium browser profiles for a matching email.
 * @param {string} email
 * @param {string} [appSupportPath] - Override for testing
 * @returns {{ browserApp: string, profileFlag: string, profileValue: string } | null}
 */
function scanChromiumProfiles(email, appSupportPath) {
	const base = appSupportPath || APP_SUPPORT;
	const normalizedEmail = email.toLowerCase();

	for (const browser of CHROMIUM_BROWSERS) {
		const browserPath = join(base, browser.base);
		if (!existsSync(browserPath)) continue;

		let entries;
		try {
			entries = readdirSync(browserPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name !== 'Default' && !entry.name.startsWith('Profile ')) continue;

			const prefsPath = join(browserPath, entry.name, 'Preferences');
			if (!existsSync(prefsPath)) continue;

			try {
				const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'));
				const accountInfo = prefs?.account_info;
				if (!Array.isArray(accountInfo)) continue;

				for (const acct of accountInfo) {
					if (acct.email && acct.email.toLowerCase() === normalizedEmail) {
						return {
							browserApp: browser.app,
							profileFlag: '--profile-directory',
							profileValue: entry.name,
						};
					}
				}
			} catch {
				// Skip unreadable/corrupted Preferences
			}
		}
	}

	return null;
}

/**
 * Scan Firefox profiles for a matching email (via Firefox Sync signedInUser.json).
 * @param {string} email
 * @param {string} [appSupportPath] - Override for testing
 * @returns {{ browserApp: string, profileFlag: string, profileValue: string } | null}
 */
function scanFirefoxProfiles(email, appSupportPath) {
	const base = appSupportPath || APP_SUPPORT;
	const firefoxBase = join(base, 'Firefox');
	const profilesIniPath = join(firefoxBase, 'profiles.ini');

	if (!existsSync(profilesIniPath)) return null;

	const normalizedEmail = email.toLowerCase();

	let iniContent;
	try {
		iniContent = readFileSync(profilesIniPath, 'utf-8');
	} catch {
		return null;
	}

	const profiles = parseFirefoxProfiles(iniContent, firefoxBase);

	for (const profile of profiles) {
		const signedInPath = join(profile.absolutePath, 'signedInUser.json');
		if (!existsSync(signedInPath)) continue;

		try {
			const data = JSON.parse(readFileSync(signedInPath, 'utf-8'));
			if (data.email && data.email.toLowerCase() === normalizedEmail) {
				return {
					browserApp: 'Firefox',
					profileFlag: '-profile',
					profileValue: profile.absolutePath,
				};
			}
		} catch {
			// Skip unreadable signedInUser.json
		}
	}

	return null;
}

/**
 * Find a browser profile matching the given email.
 * Scans Chromium-based browsers first, then Firefox.
 *
 * @param {string} email
 * @param {string} [appSupportPath] - Override ~/Library/Application Support for testing
 * @returns {{ browserApp: string, profileFlag: string, profileValue: string } | null}
 */
export function findBrowserProfileForEmail(email, appSupportPath) {
	if (!email || process.platform !== 'darwin') return null;

	return scanChromiumProfiles(email, appSupportPath)
		|| scanFirefoxProfiles(email, appSupportPath)
		|| null;
}

/**
 * Open a URL in the browser.
 * If browser profile info is provided on macOS, targets that specific profile.
 *
 * @param {string} url
 * @param {{ browserApp?: string, profileFlag?: string, profileValue?: string }} [options]
 * @returns {boolean} true if the browser was launched
 */
export function openBrowser(url, options = {}) {
	const { browserApp, profileFlag, profileValue } = options;
	const platform = process.platform;

	try {
		if (platform === 'darwin') {
			if (browserApp && profileFlag && profileValue) {
				const child = spawn('open', [
					'-na', browserApp,
					'--args', profileFlag, profileValue, url,
				], { detached: true, stdio: 'ignore' });
				if (child) child.unref();
			} else {
				const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
				if (child) child.unref();
			}
		} else if (platform === 'linux') {
			const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
			if (child) child.unref();
		} else if (platform === 'win32') {
			const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
			if (child) child.unref();
		} else {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
