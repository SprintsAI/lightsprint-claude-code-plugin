/**
 * On-demand OAuth flow for Lightsprint.
 *
 * Opens the browser to authorize-cli, waits for the callback,
 * and saves tokens to ~/.lightsprint/projects.json.
 */

import { createServer } from 'http';
import { createServer as createNetServer } from 'net';
import { exec, execSync } from 'child_process';
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
 * @returns {Promise<{ skipped?: boolean, accessToken?: string, refreshToken?: string, expiresIn?: string, project?: string, projectId?: string }>}
 */
function waitForCallback(port, timeoutMs = 120000) {
	return new Promise((resolve, reject) => {
		const sockets = new Set();
		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname === '/callback') {
				if (url.searchParams.get('skipped') === 'true') {
					res.writeHead(200, { 'Content-Type': 'text/html', 'Connection': 'close' });
					res.end('<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>Skipped</h1><p>Lightsprint won\'t be connected for this folder. You can close this tab.</p></div></body></html>');
					closeServer();
					resolve({ skipped: true });
					return;
				}
				const result = {
					accessToken: url.searchParams.get('access_token'),
					refreshToken: url.searchParams.get('refresh_token'),
					expiresIn: url.searchParams.get('expires_in'),
					project: url.searchParams.get('project'),
					projectId: url.searchParams.get('project_id')
				};
				res.writeHead(200, { 'Content-Type': 'text/html', 'Connection': 'close' });
				res.end('<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>Authorized!</h1><p>You can close this tab and return to your terminal.</p></div></body></html>');
				closeServer();
				resolve(result);
			}
		});

		server.on('connection', (socket) => {
			sockets.add(socket);
			socket.on('close', () => sockets.delete(socket));
		});

		function closeServer() {
			// Destroy lingering keep-alive sockets so the server shuts down immediately
			for (const socket of sockets) socket.destroy();
			server.close();
		}

		server.listen(port);

		const timer = setTimeout(() => {
			server.close();
			reject(new Error('Authorization timed out. Please try again.'));
		}, timeoutMs);

		server.on('close', () => clearTimeout(timer));
	});
}

/**
 * Try to extract the GitHub owner/repo from the git remote URL.
 * @returns {string|null} e.g. "owner/repo" or null
 */
function getGitRepoFullName() {
	try {
		const remote = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
		// Match SSH (git@github.com:owner/repo.git) or HTTPS (https://github.com/owner/repo.git)
		const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

/**
 * Run the full OAuth flow: open browser, wait for callback, save tokens.
 * @param {string} [baseUrl='https://lightsprint.ai']
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number, projectId: string, projectName: string, folder: string, baseUrl: string }>}
 */
export async function authenticate(baseUrl = 'https://lightsprint.ai', options = {}) {
	const { cwd, quiet } = options;
	ensureConfigDir();

	const port = await findFreePort();
	let authorizeUrl = `${baseUrl}/authorize-cli?port=${port}&scope=tasks:read+tasks:write+comments:write+plans:read+plans:write`;

	const repoFullName = getGitRepoFullName();
	if (repoFullName) {
		authorizeUrl += `&repo=${encodeURIComponent(repoFullName)}`;
	}

	if (!quiet) console.log('Opening browser to authorize with Lightsprint...');
	openBrowser(authorizeUrl);

	const result = await waitForCallback(port);

	const folder = cwd || process.cwd();

	if (result.skipped) {
		const projects = readProjectsFile();
		projects[folder] = { skipped: true };
		writeProjectsFile(projects);
		if (!quiet) console.log('Lightsprint skipped for this folder.');
		return { skipped: true, folder, baseUrl };
	}

	if (!result.accessToken) {
		throw new Error('Authorization failed — no access token received.');
	}

	const entry = {
		accessToken: result.accessToken,
		refreshToken: result.refreshToken,
		expiresAt: Date.now() + (parseInt(result.expiresIn) * 1000),
		projectId: result.projectId,
		projectName: result.project,
		baseUrl
	};

	const projects = readProjectsFile();
	projects[folder] = entry;
	writeProjectsFile(projects);

	if (!quiet) console.log(`Connected to project: ${result.project}`);

	return { ...entry, folder, baseUrl };
}
