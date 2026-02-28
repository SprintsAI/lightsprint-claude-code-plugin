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
					res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:#eeeeee;color:#020202;display:flex;align-items:center;justify-content:center;min-height:100vh}
@media(prefers-color-scheme:dark){body{background:#0A0A0A;color:#E5E5E5}.card{background:#141414;border-color:#242424}.subtitle{color:#666}.countdown{color:#666;border-color:#242424}.icon{background:rgba(90,90,90,0.1);border-color:rgba(90,90,90,0.2);color:#5c5855}h1{color:#E5E5E5}}
.card{background:#fafafa;border:1px solid #b8b3b0;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%;animation:scaleIn .3s cubic-bezier(0.175,0.885,0.32,1.275)}
@keyframes scaleIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
@keyframes fadeOut{from{opacity:1}to{opacity:0}}
.icon{width:56px;height:56px;border-radius:50%;background:rgba(90,90,90,0.08);border:1px solid rgba(90,90,90,0.2);color:#5c5855;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px}
h1{font-size:1.5rem;font-weight:700;letter-spacing:-0.01em;margin-bottom:8px;color:#020202}
.subtitle{font-size:0.875rem;color:#5c5855;line-height:1.5}
.countdown{font-family:'DM Mono',monospace;font-size:0.75rem;color:#5c5855;margin-top:20px;padding-top:16px;border-top:1px solid #b8b3b0}
.fade-out{animation:fadeOut .4s ease-out forwards}
</style></head>
<body><div class="card" id="card">
<div class="icon">\u2014</div>
<h1>Skipped</h1>
<p class="subtitle">Lightsprint won't be connected for this folder.</p>
<p class="countdown">Closing in <span id="t">3</span>s</p>
</div>
<script>
let s=3;const el=document.getElementById('t');const card=document.getElementById('card');
const iv=setInterval(()=>{s--;el.textContent=s;if(s<=0){clearInterval(iv);card.classList.add('fade-out');setTimeout(()=>{window.close();window.location.href='about:blank'},400)}},1000);
</script></body></html>`);
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
				res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:#eeeeee;color:#020202;display:flex;align-items:center;justify-content:center;min-height:100vh}
@media(prefers-color-scheme:dark){body{background:#0A0A0A;color:#E5E5E5}.card{background:#141414;border-color:#242424}.subtitle{color:#666}.countdown{color:#666;border-color:#242424}.check{background:rgba(74,222,128,0.15);border-color:rgba(74,222,128,0.3);color:rgb(74,222,128)}h1{color:#E5E5E5}}
.card{background:#fafafa;border:1px solid #b8b3b0;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%;animation:scaleIn .3s cubic-bezier(0.175,0.885,0.32,1.275)}
@keyframes scaleIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
@keyframes fadeOut{from{opacity:1}to{opacity:0}}
.check{width:56px;height:56px;border-radius:50%;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:rgb(34,197,94);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:28px}
h1{font-size:1.5rem;font-weight:700;letter-spacing:-0.01em;margin-bottom:8px;color:#020202}
.subtitle{font-size:0.875rem;color:#5c5855;line-height:1.5}
.countdown{font-family:'DM Mono',monospace;font-size:0.75rem;color:#5c5855;margin-top:20px;padding-top:16px;border-top:1px solid #b8b3b0}
.fade-out{animation:fadeOut .4s ease-out forwards}
</style></head>
<body><div class="card" id="card">
<div class="check">\u2713</div>
<h1>Authorized</h1>
<p class="subtitle">You can close this tab and return to your terminal.</p>
<p class="countdown">Closing in <span id="t">3</span>s</p>
</div>
<script>
let s=3;const el=document.getElementById('t');const card=document.getElementById('card');
const iv=setInterval(()=>{s--;el.textContent=s;if(s<=0){clearInterval(iv);card.classList.add('fade-out');setTimeout(()=>{window.close();window.location.href='about:blank'},400)}},1000);
</script></body></html>`);
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
