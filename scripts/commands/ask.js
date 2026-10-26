import { apiRequest, apiRequestSSE, getWorkspaceId } from '../lib/client.js';
import { outputResult } from '../lib/output.js';
import { resolveStackId } from '../lib/resolve-stack.js';


// ─── ask ──────────────────────────────────────────────────────────────

export async function cmdAsk(args, opts) {
	const sub = args[0];
	const subArgs = args.slice(1);

	switch (sub) {
		case 'list': return await cmdAskList(subArgs, opts);
		case 'create': return await cmdAskCreate(subArgs, opts);
		case 'get': return await cmdAskGet(subArgs, opts);
		case 'messages':
		case 'send': return await cmdAskMessages(subArgs, opts);
		case 'cancel': return await cmdAskCancel(subArgs, opts);
		case 'delete': return await cmdAskDelete(subArgs, opts);
		default:
			throw new Error(`Unknown ask subcommand: ${sub || '(none)'}. Valid: list, create, get, messages, cancel, delete`);
	}
}

async function cmdAskList(args, opts) {
	let limit = null;
	let offset = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--limit' && args[i + 1]) {
			limit = parseInt(args[++i], 10);
		} else if (args[i] === '--offset' && args[i + 1]) {
			offset = parseInt(args[++i], 10);
		} else if (!args[i].startsWith('-')) {
			// ignore stray positionals
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint ask list [--limit N] [--offset N]`);
		}
	}

	const workspaceId = await getWorkspaceId();
	let path = `/api/workspaces/${workspaceId}/ask/threads`;
	const params = [];
	if (limit != null) params.push(`limit=${limit}`);
	if (offset != null) params.push(`offset=${offset}`);
	if (params.length > 0) path += '?' + params.join('&');

	const data = await apiRequest(path);
	const threads = (data.threads || []).map(t => ({
		id: t.id,
		title: t.title || null,
		visibility: t.visibility,
		archivedAt: t.archivedAt || null,
		eventCount: t.eventCount ?? t._count?.events ?? null,
		createdAt: t.createdAt,
		updatedAt: t.updatedAt
	}));

	outputResult({ threads, total: data.total ?? threads.length }, opts, () => {
		if (threads.length === 0) {
			console.log('No ask threads found.');
			return;
		}
		console.log(`Found ${threads.length} thread(s):\n`);
		for (const t of threads) {
			const title = t.title || '(untitled)';
			const archived = t.archivedAt ? ' [archived]' : '';
			const vis = t.visibility === 'workspace' ? ' [shared]' : '';
			console.log(`  ${t.id}  ${title}${archived}${vis}`);
		}
	});
}

async function cmdAskCreate(args, opts) {
	let stackRef = null;
	let title = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--stack' && args[i + 1]) {
			stackRef = args[++i];
		} else if (args[i] === '--title' && args[i + 1]) {
			title = args[++i];
		} else if (!args[i].startsWith('-')) {
			// positional: treat as title or stack hint
			if (title == null) { title = args[i]; }
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint ask create [--stack <ref>] [--title <text>]`);
		}
	}

	const workspaceId = await getWorkspaceId();
	const executionStackId = stackRef ? await resolveStackId(workspaceId, stackRef) : null;
	const body = { executionStackId };
	if (title) body.title = title;

	const data = await apiRequest(`/api/workspaces/${workspaceId}/ask/threads`, {
		method: 'POST',
		body: JSON.stringify(body)
	});
	const thread = data.thread;

	outputResult({ thread }, opts, () => {
		console.log(`Created ask thread: ${thread.id}`);
		if (thread.title) console.log(`Title: ${thread.title}`);
		console.log(`Visibility: ${thread.visibility}`);
	});
}

async function cmdAskGet(args, opts) {
	const threadIdInput = parseThreadReference({ args, command: 'get' });

	const workspaceId = await getWorkspaceId();
	const data = await apiRequest(`/api/workspaces/${workspaceId}/ask/threads/${threadIdInput}`);
	const thread = data.thread;

	outputResult({ thread }, opts, () => {
		console.log(`Thread: ${thread.id}`);
		console.log(`Title: ${thread.title || '(untitled)'}`);
		console.log(`Visibility: ${thread.visibility}`);
		console.log(`Archived: ${thread.archivedAt ? 'yes' : 'no'}`);
		console.log(`Created: ${thread.createdAt}`);
		console.log(`Updated: ${thread.updatedAt}`);
	});
}

async function cmdAskMessages(args, opts) {
	let threadIdInput = null;
	let content = null;
	let last = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--thread' && args[i + 1]) {
			threadIdInput = args[++i];
		} else if (args[i] === '--content' && args[i + 1]) {
			content = args[++i];
		} else if (args[i] === '--last' && args[i + 1]) {
			last = parseInt(args[++i], 10);
		} else if (!threadIdInput && !args[i].startsWith('-')) {
			threadIdInput = args[i];
		} else if (!content && threadIdInput && !args[i].startsWith('-')) {
			content = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: lightsprint ask messages <threadId> [--content <text>] [--last N]`);
		}
	}

	if (!threadIdInput) throw new Error('Usage: lightsprint ask messages <threadId> [--content <text>] [--last N]');

	const workspaceId = await getWorkspaceId();

	if (content) {
		// Send a message (SSE endpoint — use apiRequestSSE for streaming support)
		const body = JSON.stringify({ content });
		const result = await apiRequestSSE(`/api/workspaces/${workspaceId}/ask/threads/${threadIdInput}/messages`, {
			body,
			method: 'POST'
		});
		outputResult({ result }, opts, () => {
			console.log(`Message sent to thread ${threadIdInput}`);
			if (result) console.log(JSON.stringify(result, null, 2));
		});
	} else {
		// Fetch conversation history (events endpoint)
		const data = await apiRequest(`/api/workspaces/${workspaceId}/ask/threads/${threadIdInput}/events`);
		let events = data.events || [];
		if (last != null && last > 0) {
			events = events.slice(-last);
		}
		outputResult({ events }, opts, () => {
			if (events.length === 0) {
				console.log(`No messages in thread ${threadIdInput}.`);
				return;
			}
			console.log(`Messages in thread ${threadIdInput} (${events.length}${last != null ? ` of ${last} requested` : ''}):\n`);
			for (const evt of events) {
				const role = evt.role || 'unknown';
				const text = typeof evt.content === 'string' ? evt.content : JSON.stringify(evt.content);
				const preview = text.slice(0, 280).replace(/\n/g, ' ');
				console.log(`  [${role}] ${preview}${text.length > 280 ? '...' : ''}`);
			}
		});
	}
}

async function cmdAskCancel(args, opts) {
	const threadIdInput = parseThreadReference({ args, command: 'cancel' });

	const workspaceId = await getWorkspaceId();
	const data = await apiRequest(`/api/workspaces/${workspaceId}/ask/threads/${threadIdInput}/cancel`, {
		method: 'POST'
	});

	outputResult(data, opts, () => {
		if (data.cancelled) {
			console.log(`Cancelled active turn on thread ${threadIdInput}.`);
		} else {
			console.log(`No active turn to cancel on thread ${threadIdInput} (${data.reason || 'unknown'}).`);
		}
	});
}

async function cmdAskDelete(args, opts) {
	const threadIdInput = parseThreadReference({ args, command: 'delete' });

	const workspaceId = await getWorkspaceId();
	await apiRequest(`/api/workspaces/${workspaceId}/ask/threads/${threadIdInput}`, {
		method: 'DELETE'
	});

	outputResult({ success: true, threadId: threadIdInput }, opts, () => {
		console.log(`Deleted thread ${threadIdInput}.`);
	});
}

function parseThreadReference({ args, command }) {
	let threadIdInput = null;
	const usage = `lightsprint ask ${command} <threadId>`;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--thread' && args[i + 1]) {
			threadIdInput = args[++i];
		} else if (!threadIdInput && !args[i].startsWith('-')) {
			threadIdInput = args[i];
		} else {
			throw new Error(`Unknown argument: ${args[i]}. Use: ${usage}`);
		}
	}
	if (!threadIdInput) throw new Error(`Usage: ${usage}`);
	return threadIdInput;
}
