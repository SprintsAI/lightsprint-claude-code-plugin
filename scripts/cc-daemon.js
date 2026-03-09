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
 *   LS_REPO_ID, LS_SESSION_ID, LS_CWD, LS_CC_PID, LS_GIT_BRANCH
 */

import { createServer } from 'http';
import { readSessionState, writeSessionState, deleteSessionState, isPidAlive, createLogger, findFreePort } from './lib/cc-utils.js';
import { outputAllow, outputDeny, extractPlanFromTranscript, readPlanFromFile, waitForCallback } from './review-plan.js';
import { apiRequest, setConfig } from './lib/client.js';
import { setMapping, getMapping, removeSessionMappings } from './lib/task-map.js';
import { ccToLsStatus } from './lib/status-mapper.js';
import { getActivePlan, setActivePlan, clearActivePlan } from './lib/plan-tracker.js';
import { openBrowser } from './lib/browser.js';
import { getConfig, readReposFile, writeReposFile } from './lib/config.js';
import { createHash, randomBytes } from 'crypto';
import { hostname, homedir } from 'os';
import { resolve, normalize } from 'path';
import { validateId } from './lib/validate.js';

import { readFileSync, unlinkSync, realpathSync } from 'fs';

// Resolve config: credentials file (secure) > env vars (legacy) > repos.json
const CWD = process.env.LS_CWD || process.cwd();
const repoConfig = getConfig(CWD);

let _accessToken, _refreshToken, _expiresAt;
const credsFile = process.env.LS_CREDS_FILE;
if (credsFile) {
	try {
		const creds = JSON.parse(readFileSync(credsFile, 'utf-8'));
		_accessToken = creds.accessToken;
		_refreshToken = creds.refreshToken;
		_expiresAt = creds.expiresAt ? parseInt(creds.expiresAt, 10) : undefined;
		// Delete credentials file immediately after reading
		try { unlinkSync(credsFile); } catch { /* ignore */ }
	} catch {
		// Fall back to env vars / config
	}
}

let ACCESS_TOKEN = _accessToken || process.env.LS_ACCESS_TOKEN || repoConfig?.accessToken;
let REFRESH_TOKEN = _refreshToken || process.env.LS_REFRESH_TOKEN || repoConfig?.refreshToken;
let EXPIRES_AT = _expiresAt || (process.env.LS_EXPIRES_AT ? parseInt(process.env.LS_EXPIRES_AT, 10) : repoConfig?.expiresAt);
const BASE_URL = process.env.LS_BASE_URL || repoConfig?.baseUrl;
const REPO_ID = process.env.LS_REPO_ID || repoConfig?.repoId;
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

// Local auth token — required on all daemon HTTP endpoints (except /health for liveness probes)
const DAEMON_AUTH_TOKEN = randomBytes(32).toString('hex');

// WebSocket request-response tracking
let msgIdCounter = 0;
const pendingRequests = new Map(); // id -> { resolve, reject, timer }

// -- Task Sync State --
let cachedParentLsTaskId = null; // null=unchecked, ''=none found

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
	try { removeSessionMappings(CC_SESSION_ID); } catch (err) {
		log('Failed to clean task mappings', { error: err.message });
	}
	if (ws) { try { ws.close(1000, 'shutdown'); } catch { /* ignore */ } ws = null; }
	if (httpServer) httpServer.close();
	deleteSessionState(CC_SESSION_ID);
	log('Cleanup complete');
	process.exit(0);
}

// -- Token Refresh --

async function refreshTokenIfNeeded() {
	const fiveMinutes = 5 * 60 * 1000;
	if (EXPIRES_AT && EXPIRES_AT > Date.now() + fiveMinutes) {
		return true; // Token still valid
	}
	if (!REFRESH_TOKEN) {
		log('Token expired and no refresh token available');
		return false;
	}
	try {
		const response = await fetch(`${BASE_URL}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: REFRESH_TOKEN
			})
		});
		if (!response.ok) {
			log('Token refresh failed', { status: response.status });
			return false;
		}
		const data = await response.json();
		ACCESS_TOKEN = data.access_token;
		REFRESH_TOKEN = data.refresh_token;
		EXPIRES_AT = Date.now() + (data.expires_in * 1000);

		// Persist to repos.json so other processes pick up the new tokens
		if (repoConfig?.repo) {
			try {
				const repos = readReposFile();
				const key = repoConfig.repo;
				if (repos[key]) {
					repos[key].accessToken = ACCESS_TOKEN;
					repos[key].refreshToken = REFRESH_TOKEN;
					repos[key].expiresAt = EXPIRES_AT;
					writeReposFile(repos);
				}
			} catch (err) {
				log('Failed to persist refreshed tokens', { error: err.message });
			}
		}

		log('Token refreshed successfully');
		return true;
	} catch (err) {
		log('Token refresh error', { error: err.message });
		return false;
	}
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

async function connectWebSocket() {
	// Refresh token if expired before attempting connection
	const refreshed = await refreshTokenIfNeeded();
	if (!refreshed) {
		log('Cannot connect: token refresh failed');
		scheduleReconnect();
		return;
	}

	const wsUrl = BASE_URL.replace(/^http/, 'ws') + `/cc-ws?token=${encodeURIComponent(ACCESS_TOKEN)}`;

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
				// Persist lsSessionId to session file so CLI tools can discover it
				const currentState = readSessionState(CC_SESSION_ID);
				if (currentState) {
					writeSessionState(CC_SESSION_ID, { ...currentState, lsSessionId });
				}
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

		// Auth check for all mutating endpoints
		const authHeader = req.headers['authorization'];
		const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
		if (providedToken !== DAEMON_AUTH_TOKEN) {
			res.writeHead(401, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
			return;
		}

		if (url.pathname === '/event' && req.method === 'POST') {
			try {
				const body = await readBody(req);
				const data = JSON.parse(body);
				log('Event received', { eventType: data.eventType });

				// Stream to WS (existing behavior)
				if (ws?.readyState === WebSocket.OPEN && lsSessionId) {
					sendFireAndForget('events', {
						events: [{
							eventType: data.eventType,
							payload: data.payload,
							clientTimestamp: new Date().toISOString(),
						}]
					});
				}

				// Task sync handlers (fire-and-forget, non-blocking)
				if (lsSessionId) {
					const hookEvent = data.payload?.hook_event_name;
					const toolName = data.payload?.tool_name;
					if (hookEvent === 'PostToolUse' && toolName === 'TaskCreate') {
						handleTaskCreate(data.payload).catch(err =>
							log('handleTaskCreate error', { error: err.message }));
					} else if (hookEvent === 'PostToolUse' && toolName === 'TaskUpdate') {
						handleTaskUpdate(data.payload).catch(err =>
							log('handleTaskUpdate error', { error: err.message }));
					} else if (hookEvent === 'TaskCompleted') {
						handleTaskCompleted(data.payload).catch(err =>
							log('handleTaskCompleted error', { error: err.message }));
					}
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
		// Validate transcriptPath is within ~/.claude/ — use realpathSync to resolve symlinks
		try {
			const resolvedPath = realpathSync(resolve(normalize(transcriptPath)));
			const claudeDir = realpathSync(resolve(homedir(), '.claude'));
			if (resolvedPath.startsWith(claudeDir + '/') || resolvedPath.startsWith(claudeDir + '\\')) {
				planContent = extractPlanFromTranscript(resolvedPath, CWD);
			} else {
				log('Rejected transcriptPath outside ~/.claude/', { transcriptPath: resolvedPath });
			}
		} catch (err) {
			log('Failed to resolve transcriptPath', { transcriptPath, error: err.message });
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

	if (activePlan && activePlan.repoId === REPO_ID && activePlan.sessionId === hookSessionId) {
		try {
			validateId(activePlan.planId, 'Plan ID');
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
		validateId(REPO_ID, 'Repo ID');
		const createResult = await apiRequest(`/api/repos/${REPO_ID}/plans`, {
			method: 'POST',
			body: JSON.stringify({ content: planContent, allowedPrompts, ccSessionId: lsSessionId || undefined })
		});
		planId = createResult?.planId || createResult?.id;
		if (!planId) return { decision: 'allow' };
	}

	setActivePlan(planId, REPO_ID, hookSessionId);

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

// -- Task Sync Handlers --

/**
 * Get the LS task ID linked to this CC session.
 * Caches result: null=unchecked, ''=checked but none found, string=found.
 */
async function getParentLsTaskId() {
	if (cachedParentLsTaskId !== null) return cachedParentLsTaskId || null;
	if (!lsSessionId) { cachedParentLsTaskId = ''; return null; }
	try {
		const data = await apiRequest(`/api/cc-sessions/${lsSessionId}/task`);
		if (data?.task?.id) {
			cachedParentLsTaskId = data.task.id;
			return cachedParentLsTaskId;
		}
	} catch (err) {
		log('Failed to fetch session task', { error: err.message });
	}
	cachedParentLsTaskId = '';
	return null;
}

/**
 * Handle PostToolUse:TaskCreate — create LS child task of the session's current task.
 * Every CC task becomes an LS subtask linked as a dependency of the parent.
 */
async function handleTaskCreate(payload) {
	const ccTaskId = String(payload.tool_response?.task?.id || '');
	if (!ccTaskId) return;

	// Skip if already mapped (idempotency)
	if (getMapping(CC_SESSION_ID, ccTaskId)) return;

	const parentLsTaskId = await getParentLsTaskId();
	if (!parentLsTaskId) return; // No LS task linked to session — skip silently

	const title = payload.tool_input?.subject || 'Untitled';
	const description = payload.tool_input?.description || '';

	try {
		validateId(REPO_ID, 'Repo ID');
		const data = await apiRequest(`/api/repos/${REPO_ID}/tasks`, {
			method: 'POST',
			body: JSON.stringify({ title, description, status: ccToLsStatus('pending') })
		});
		const newLsId = data?.task?.id;
		if (!newLsId) {
			log('TaskCreate: no task ID in create response');
			return;
		}
		validateId(newLsId, 'New LS task ID');
		setMapping(CC_SESSION_ID, ccTaskId, newLsId);
		log('Subtask created in LS', { ccTaskId, lsTaskId: newLsId, parentLsTaskId });

		// Link as dependency: parent depends-on subtask
		try {
			validateId(parentLsTaskId, 'Parent LS task ID');
			await apiRequest(`/api/tasks/${parentLsTaskId}/dependencies`, {
				method: 'POST',
				body: JSON.stringify({ dependsOnTaskId: newLsId })
			});
		} catch (err) {
			log('TaskCreate: failed to add dependency link', { error: err.message });
		}
	} catch (err) {
		log('TaskCreate: failed to create LS subtask', { error: err.message });
	}
}

/**
 * Handle PostToolUse:TaskUpdate — reparent on addBlockedBy, sync status changes.
 */
async function handleTaskUpdate(payload) {
	const ccTaskId = String(payload.tool_input?.taskId || '');
	if (!ccTaskId) return;

	const lsTaskId = getMapping(CC_SESSION_ID, ccTaskId);
	if (!lsTaskId) return;

	// Reparent: when addBlockedBy is set, move this task from session parent to blocker
	const addBlockedBy = payload.tool_input?.addBlockedBy;
	if (Array.isArray(addBlockedBy) && addBlockedBy.length > 0) {
		const parentLsTaskId = await getParentLsTaskId();
		for (const blockerCcId of addBlockedBy) {
			const blockerLsId = getMapping(CC_SESSION_ID, String(blockerCcId));
			if (!blockerLsId) continue;

			// Remove dep: session parent depends-on this task
			if (parentLsTaskId) {
				try {
					validateId(parentLsTaskId, 'Parent LS task ID');
					validateId(lsTaskId, 'LS task ID');
					await apiRequest(`/api/tasks/${parentLsTaskId}/dependencies`, {
						method: 'DELETE',
						body: JSON.stringify({ dependsOnTaskId: lsTaskId })
					});
				} catch (err) {
					log('TaskUpdate: failed to remove parent dep', { error: err.message });
				}
			}

			// Add dep: blocker depends-on this task
			try {
				validateId(blockerLsId, 'Blocker LS task ID');
				validateId(lsTaskId, 'LS task ID');
				await apiRequest(`/api/tasks/${blockerLsId}/dependencies`, {
					method: 'POST',
					body: JSON.stringify({ dependsOnTaskId: lsTaskId })
				});
				log('TaskUpdate: reparented', { ccTaskId, from: parentLsTaskId, to: blockerLsId });
			} catch (err) {
				log('TaskUpdate: failed to add blocker dep', { error: err.message });
			}
			break; // Reparent to first mapped blocker
		}
	}

	// Status sync
	const ccStatus = payload.tool_input?.status;
	if (ccStatus) {
		const lsStatus = ccToLsStatus(ccStatus);
		if (lsStatus) {
			try {
				validateId(lsTaskId, 'LS task ID');
				await apiRequest(`/api/tasks/${lsTaskId}`, {
					method: 'PATCH',
					body: JSON.stringify({ status: lsStatus })
				});
				log('TaskUpdate synced', { ccTaskId, lsTaskId, lsStatus });
			} catch (err) {
				log('TaskUpdate: status sync failed', { error: err.message, lsTaskId });
			}
		}
	}
}

/**
 * Handle TaskCompleted — mark LS task as done.
 */
async function handleTaskCompleted(payload) {
	const ccTaskId = String(payload.task_id || '');
	if (!ccTaskId) return;
	const lsTaskId = getMapping(CC_SESSION_ID, ccTaskId);
	if (!lsTaskId) return;
	try {
		validateId(lsTaskId, 'LS task ID');
		await apiRequest(`/api/tasks/${lsTaskId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: ccToLsStatus('completed') })
		});
		log('TaskCompleted synced', { ccTaskId, lsTaskId });
	} catch (err) {
		log('TaskCompleted: sync failed', { error: err.message, lsTaskId });
	}
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
	log('Starting daemon', { ccSessionId: CC_SESSION_ID, repoId: REPO_ID, ccPid: CC_PID });

	if (!ACCESS_TOKEN || !BASE_URL || !REPO_ID || !CC_SESSION_ID) {
		log('Missing required env vars');
		process.exit(1);
	}

	// Inject config for API requests — use getters so client.js always sees refreshed tokens
	setConfig({
		get accessToken() { return ACCESS_TOKEN; },
		get refreshToken() { return REFRESH_TOKEN; },
		get expiresAt() { return EXPIRES_AT; },
		baseUrl: BASE_URL,
		repoId: REPO_ID,
		repo: repoConfig?.repo,
	});

	// Start local HTTP server
	const port = await startHttpServer();
	log('HTTP server started', { port });

	// Connect WebSocket
	connectWebSocket();

	// Save session state (includes daemon auth token for CLI callers)
	writeSessionState(CC_SESSION_ID, {
		port,
		daemonPid: process.pid,
		ccPid: CC_PID,
		ccSessionId: CC_SESSION_ID,
		lsSessionId: null, // Updated after session:start ack
		repoId: REPO_ID,
		daemonToken: DAEMON_AUTH_TOKEN,
	});

	// Start PID watchdog
	startWatchdog();

	// Handle signals
	process.on('SIGTERM', () => shutdown('sigterm'));
	process.on('SIGINT', () => shutdown('sigint'));

	log('Daemon running', { port, ccPid: CC_PID });
}
