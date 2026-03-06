/**
 * cc-daemon.js — Long-lived persistent process per CC session.
 *
 * Runs two servers:
 * 1. Native WebSocket client → connects to Lightsprint /cc-ws (streams events)
 * 2. Local HTTP server → localhost:{port} (receives from hook CLI subcommands)
 *
 * Lifecycle:
 * 1. Read config from env vars
 * 2. Find free port, start local HTTP server
 * 3. Connect to Lightsprint /cc-ws WebSocket with Bearer token
 * 4. Send session:start
 * 5. Save session state file
 * 6. Start CC PID watchdog (kill(ccPid,0) every 5s)
 * 7. Handle incoming requests from hooks via local HTTP
 * 8. On shutdown: send session:end, cleanup, exit
 *
 * Env vars (set by cc-start.js):
 *   LS_ACCESS_TOKEN, LS_REFRESH_TOKEN, LS_EXPIRES_AT, LS_BASE_URL,
 *   LS_PROJECT_ID, LS_SESSION_ID, LS_CWD, LS_CC_PID, LS_GIT_BRANCH
 */

import { createServer } from 'http';
import { writeSessionState, deleteSessionState, isPidAlive, createLogger, findFreePort } from './lib/cc-utils.js';
import { outputAllow, outputDeny, extractPlanFromTranscript, readPlanFromFile, waitForCallback } from './review-plan.js';
import { apiRequest, setConfig } from './lib/client.js';
import { getActivePlan, setActivePlan, clearActivePlan } from './lib/plan-tracker.js';
import { openBrowser } from './lib/browser.js';
import { getConfig } from './lib/config.js';
import { createHash } from 'crypto';
import { hostname, homedir } from 'os';
import { resolve, normalize } from 'path';

// Resolve config: env vars take precedence, fall back to projects.json
const CWD = process.env.LS_CWD || process.cwd();
const projectConfig = getConfig(CWD);

const ACCESS_TOKEN = process.env.LS_ACCESS_TOKEN || projectConfig?.accessToken;
const REFRESH_TOKEN = process.env.LS_REFRESH_TOKEN || projectConfig?.refreshToken;
const EXPIRES_AT = process.env.LS_EXPIRES_AT ? parseInt(process.env.LS_EXPIRES_AT, 10) : projectConfig?.expiresAt;
const BASE_URL = process.env.LS_BASE_URL || projectConfig?.baseUrl;
const PROJECT_ID = process.env.LS_PROJECT_ID || projectConfig?.projectId;
const CC_SESSION_ID = process.env.LS_SESSION_ID;
const CC_PID = parseInt(process.env.LS_CC_PID, 10);
const GIT_BRANCH = process.env.LS_GIT_BRANCH || null;

// Compute machine ID (hashed hostname)
const MACHINE_ID = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);

let ws = null;
let httpServer = null;
let lsSessionId = null; // Lightsprint DB session ID
let shuttingDown = false;
let watchdogInterval = null;

// WebSocket request-response tracking
let msgIdCounter = 0;
const pendingRequests = new Map(); // id -> { resolve, reject, timer }

const log = createLogger('cc-daemon');

function sendRequest(type, data, timeoutMs = 10000) {
	return new Promise((resolve, reject) => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return reject(new Error('WebSocket not connected'));
		}
		const id = `msg_${++msgIdCounter}`;
		const timer = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`Request ${id} timed out`));
		}, timeoutMs);
		pendingRequests.set(id, { resolve, reject, timer });
		ws.send(JSON.stringify({ type, id, data }));
	});
}

function sendFireAndForget(type, data) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	try {
		ws.send(JSON.stringify({ type, data }));
	} catch { /* ignore */ }
}

async function shutdown(reason) {
	if (shuttingDown) return;
	shuttingDown = true;
	log('Shutting down', { reason });

	if (watchdogInterval) clearInterval(watchdogInterval);

	// Tell server session ended
	if (ws?.readyState === WebSocket.OPEN && lsSessionId) {
		try {
			await sendRequest('session:end', {
				status: reason === 'cc_process_dead' ? 'errored' : 'completed'
			}, 2000);
		} catch { /* ignore */ }
	}

	// Cleanup
	if (ws) { try { ws.close(1000, 'shutdown'); } catch { /* ignore */ } ws = null; }
	if (httpServer) httpServer.close();
	deleteSessionState(CC_SESSION_ID);
	log('Cleanup complete');
	process.exit(0);
}

// -- WebSocket Client --

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

function getReconnectDelay() {
	const delay = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts), MAX_DELAY);
	return delay * (0.8 + Math.random() * 0.4); // +/- 20% jitter
}

function scheduleReconnect() {
	if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS || shuttingDown) {
		log('Max reconnect attempts reached, shutting down');
		shutdown('max_reconnect');
		return;
	}
	const delay = getReconnectDelay();
	reconnectAttempts++;
	log('Scheduling reconnect', { attempt: reconnectAttempts, delayMs: Math.round(delay) });
	setTimeout(connectWebSocket, delay);
}

function connectWebSocket() {
	const wsUrl = BASE_URL.replace(/^http/, 'ws') + '/cc-ws?token=' + encodeURIComponent(ACCESS_TOKEN);

	try {
		ws = new WebSocket(wsUrl);
	} catch (err) {
		log('WebSocket creation error', { error: err.message });
		scheduleReconnect();
		return;
	}

	ws.onopen = async () => {
		reconnectAttempts = 0;
		log('WebSocket connected');

		try {
			const response = await sendRequest('session:start', {
				ccSessionId: CC_SESSION_ID,
				gitBranch: GIT_BRANCH,
				machineId: MACHINE_ID,
			});
			if (response?.ok) {
				lsSessionId = response.sessionId;
				log('Session started', { lsSessionId });
			} else {
				log('Session start failed, triggering reconnect', { error: response?.error });
				try { ws.close(4000, 'session_start_failed'); } catch { /* ignore */ }
			}
		} catch (err) {
			log('Session start error, triggering reconnect', { error: err.message });
			try { ws.close(4000, 'session_start_error'); } catch { /* ignore */ }
		}
	};

	ws.onmessage = (event) => {
		let msg;
		try {
			msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
		} catch {
			return;
		}

		if (msg.type === 'ping') {
			try { ws.send(JSON.stringify({ type: 'pong' })); } catch { /* ignore */ }
			return;
		}

		if (msg.type === 'ack' && msg.id) {
			const pending = pendingRequests.get(msg.id);
			if (pending) {
				clearTimeout(pending.timer);
				pendingRequests.delete(msg.id);
				pending.resolve(msg);
			}
			return;
		}
	};

	ws.onclose = (event) => {
		log('WebSocket closed', { code: event.code, reason: event.reason });
		// Reject all pending requests
		for (const [id, pending] of pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error('WebSocket closed'));
		}
		pendingRequests.clear();

		if (!shuttingDown) {
			scheduleReconnect();
		}
	};

	ws.onerror = (event) => {
		log('WebSocket error');
		// onclose will follow
	};
}

// -- Local HTTP Server --

async function startHttpServer() {
	const port = await findFreePort();

	httpServer = createServer(async (req, res) => {
		const url = new URL(req.url, `http://localhost:${port}`);

		// No CORS headers — daemon is only accessed by local CLI tools via localhost

		if (url.pathname === '/health' && req.method === 'GET') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true, sessionId: lsSessionId }));
			return;
		}

		if (url.pathname === '/event' && req.method === 'POST') {
			try {
				const body = await readBody(req);
				const data = JSON.parse(body);
				log('Event received', { eventType: data.eventType });
				if (ws?.readyState === WebSocket.OPEN && lsSessionId) {
					sendFireAndForget('events', {
						events: [{
							eventType: data.eventType,
							payload: data.payload,
							clientTimestamp: new Date().toISOString(),
						}]
					});
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: true }));
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: false, error: err.message }));
			}
			return;
		}

		if (url.pathname === '/review-plan' && req.method === 'POST') {
			try {
				const body = await readBody(req);
				const data = JSON.parse(body);
				const decision = await handlePlanReview(data);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(decision));
			} catch (err) {
				log('Plan review error', { error: err.message });
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ decision: 'allow' }));
			}
			return;
		}

		if (url.pathname === '/session-end' && req.method === 'POST') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true }));
			// Shutdown after response
			setTimeout(() => shutdown('session_end_requested'), 100);
			return;
		}

		res.writeHead(404);
		res.end('Not found');
	});

	await new Promise((resolve) => {
		httpServer.listen(port, '127.0.0.1', resolve);
	});

	return port;
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = '';
		let size = 0;
		const MAX = 1024 * 1024; // 1MB
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX) { req.destroy(); reject(new Error('Body too large')); return; }
			body += chunk;
		});
		req.on('end', () => resolve(body));
		req.on('error', reject);
	});
}

// -- Plan Review Handler --

async function handlePlanReview(data) {
	const { plan, allowedPrompts, transcriptPath, sessionId: hookSessionId } = data;

	let planContent = plan;
	if (!planContent && transcriptPath) {
		// Validate transcriptPath is within ~/.claude/ to prevent path traversal
		const resolvedPath = resolve(normalize(transcriptPath));
		const claudeDir = resolve(homedir(), '.claude');
		if (resolvedPath.startsWith(claudeDir + '/') || resolvedPath.startsWith(claudeDir + '\\')) {
			planContent = extractPlanFromTranscript(resolvedPath, CWD);
		} else {
			log('Rejected transcriptPath outside ~/.claude/', { transcriptPath: resolvedPath });
		}
	}
	if (!planContent) {
		planContent = readPlanFromFile(CWD);
	}

	if (!planContent) {
		return { decision: 'allow' };
	}

	// Upload plan
	let planId;
	const activePlan = getActivePlan();

	if (activePlan && activePlan.projectId === PROJECT_ID && activePlan.sessionId === hookSessionId) {
		try {
			await apiRequest(`/api/plans/${activePlan.planId}/versions`, {
				method: 'PUT',
				body: JSON.stringify({ content: planContent })
			});
			planId = activePlan.planId;
		} catch {
			planId = null;
		}
	}

	if (!planId) {
		const createResult = await apiRequest(`/api/projects/${PROJECT_ID}/plans`, {
			method: 'POST',
			body: JSON.stringify({ content: planContent, allowedPrompts })
		});
		planId = createResult?.planId || createResult?.id;
		if (!planId) return { decision: 'allow' };
	}

	setActivePlan(planId, PROJECT_ID, hookSessionId);

	// Start callback server and open browser
	const callbackPort = await findFreePort();
	const callbackUrl = `http://localhost:${callbackPort}/callback`;
	const reviewUrl = `${BASE_URL}/plans/${planId}?callback=${encodeURIComponent(callbackUrl)}`;

	openBrowser(reviewUrl);
	log('Plan review opened', { reviewUrl });

	const { decision, feedback, chatContext } = await waitForCallback(callbackPort);

	if (decision === 'deny' || decision === 'denied' || decision === 'reject') {
		function formatChatContext(ctx) {
			if (!ctx || ctx.length === 0) return '';
			const chatLines = ctx.filter(m => m.messageType === 'chat').map(m => `${m.senderName}: ${m.content}`).join('\n');
			return chatLines ? '\n\n--- Reviewer Discussion ---\n' + chatLines : '';
		}
		return {
			decision: 'deny',
			feedback: (feedback || 'Plan rejected by reviewer.') + formatChatContext(chatContext)
		};
	}

	clearActivePlan();
	return { decision: 'allow' };
}

// -- PID Watchdog --

function startWatchdog() {
	if (!CC_PID || isNaN(CC_PID)) return;

	watchdogInterval = setInterval(() => {
		if (!isPidAlive(CC_PID)) {
			log('CC process dead, shutting down', { ccPid: CC_PID });
			shutdown('cc_process_dead');
		}
	}, 5000);
}

// -- Main --

export async function main() {
	log('Starting daemon', { ccSessionId: CC_SESSION_ID, projectId: PROJECT_ID, ccPid: CC_PID });

	if (!ACCESS_TOKEN || !BASE_URL || !PROJECT_ID || !CC_SESSION_ID) {
		log('Missing required env vars');
		process.exit(1);
	}

	// Inject config for API requests (once at startup)
	setConfig({
		accessToken: ACCESS_TOKEN,
		refreshToken: REFRESH_TOKEN,
		expiresAt: EXPIRES_AT,
		baseUrl: BASE_URL,
		projectId: PROJECT_ID,
		configKey: projectConfig?.configKey,
		folder: projectConfig?.folder,
	});

	// Start local HTTP server
	const port = await startHttpServer();
	log('HTTP server started', { port });

	// Connect WebSocket
	connectWebSocket();

	// Save session state
	writeSessionState(CC_SESSION_ID, {
		port,
		pid: process.pid,
		ccPid: CC_PID,
		ccSessionId: CC_SESSION_ID,
		lsSessionId: null, // Updated after session:start ack
		projectId: PROJECT_ID,
	});

	// Start PID watchdog
	startWatchdog();

	// Handle signals
	process.on('SIGTERM', () => shutdown('sigterm'));
	process.on('SIGINT', () => shutdown('sigint'));

	log('Daemon running', { port, ccPid: CC_PID });
}
