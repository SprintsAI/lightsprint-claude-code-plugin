/**
 * On-demand OAuth flow for Lightsprint.
 *
 * Opens the browser to authorize-cli, waits for the callback,
 * and saves tokens to ~/.lightsprint/projects.json.
 */

import { createServer } from 'http';
import { createServer as createNetServer } from 'net';
import { exec } from 'child_process';
import { readProjectsFile, writeProjectsFile, ensureConfigDir } from './config.js';

/**
 * Find a free TCP port by binding to port 0.
 * @returns {Promise<number>}
 */
function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.listen(0, () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

/**
 * Open a URL in the default browser.
 * Falls back to printing the URL if no opener is available.
 */
function openBrowser(url) {
	const commands = [
		`open "${url}"`,          // macOS
		`xdg-open "${url}"`,      // Linux
		`start "" "${url}"`       // Windows
	];

	let opened = false;
	for (const cmd of commands) {
		try {
			exec(cmd);
			opened = true;
			break;
		} catch {
			// Try next
		}
	}

	if (!opened) {
		console.log('Open this URL in your browser:');
		console.log(`  ${url}`);
	}
}

/**
 * Start a local HTTP server and wait for the OAuth callback.
 * @param {number} port
 * @param {number} [timeoutMs=120000]
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: string, project: string, projectId: string }>}
 */
function waitForCallback(port, timeoutMs = 120000) {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname === '/callback') {
				const result = {
					accessToken: url.searchParams.get('access_token'),
					refreshToken: url.searchParams.get('refresh_token'),
					expiresIn: url.searchParams.get('expires_in'),
					project: url.searchParams.get('project'),
					projectId: url.searchParams.get('project_id')
				};
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end('<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>Authorized!</h1><p>You can close this tab and return to your terminal.</p></div></body></html>');
				server.close();
				resolve(result);
			}
		});

		server.listen(port);

		const timer = setTimeout(() => {
			server.close();
			reject(new Error('Authorization timed out. Please try again.'));
		}, timeoutMs);

		server.on('close', () => clearTimeout(timer));
	});
}

/**
 * Run the full OAuth flow: open browser, wait for callback, save tokens.
 * @param {string} [baseUrl='https://lightsprint.ai']
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string, baseUrl: string }>}
 */
export async function authenticate(baseUrl = 'https://lightsprint.ai') {
	ensureConfigDir();

	const port = await findFreePort();
	const authorizeUrl = `${baseUrl}/authorize-cli?port=${port}&scope=tasks:read+tasks:write+kanban:read+comments:write`;

	console.log('Opening browser to authorize with Lightsprint...');
	openBrowser(authorizeUrl);

	const result = await waitForCallback(port);

	if (!result.accessToken) {
		throw new Error('Authorization failed — no access token received.');
	}

	const folder = process.cwd();
	const entry = {
		accessToken: result.accessToken,
		refreshToken: result.refreshToken,
		expiresAt: Date.now() + (parseInt(result.expiresIn) * 1000),
		projectId: result.projectId,
		projectName: result.project
	};

	const projects = readProjectsFile();
	projects[folder] = entry;
	writeProjectsFile(projects);

	console.log(`Connected to project: ${result.project}`);

	return { ...entry, folder, baseUrl };
}
