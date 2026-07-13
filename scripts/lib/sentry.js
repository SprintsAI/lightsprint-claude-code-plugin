/**
 * Sentry crash reporting module.
 *
 * Centralized Sentry initialization for the daemon process.
 * All Sentry configuration, context management, and shutdown
 * are handled through this module.
 */

import * as Sentry from '@sentry/node';
import { createHash } from 'crypto';

// Build-time defines (injected via --define in compile.sh)
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

// Sentry DSN — injected at build time from .env, falls back to env var at runtime
const SENTRY_DSN = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : process.env.SENTRY_DSN;

let initialized = false;

/** @internal Reset module state for testing. */
export function _resetForTesting() {
	initialized = false;
}

/**
 * Initialize Sentry for crash reporting.
 * Call once at daemon startup before any other Sentry calls.
 * @param {{ baseUrl: string }} options
 */
export function initSentry({ baseUrl }) {
	if (initialized) return;

	const environment = baseUrl?.includes('localhost') || baseUrl?.includes('staging')
		? 'staging'
		: 'production';

	Sentry.init({
		dsn: SENTRY_DSN,
		environment,
		release: `lightsprint-plugin@${BUILD_VERSION}+${BUILD_HASH}`,
		tracesSampleRate: 0,
		attachStacktrace: true,
	});

	Sentry.setTag('nodeVersion', process.version);
	Sentry.setTag('platform', process.platform);

	initialized = true;
}

/**
 * Set Sentry user and session context.
 * @param {{ email?: string, workspaceId?: string, repoId?: string, sessionId?: string, machineId?: string }} ctx
 */
export function setSentryContext({ email, workspaceId, repoId, sessionId, machineId }) {
	if (email) {
		const hashedId = createHash('sha256').update(email).digest('hex').slice(0, 16);
		Sentry.setUser({ id: hashedId, email });
	}
	if (workspaceId) Sentry.setTag('workspaceId', workspaceId);
	if (repoId) Sentry.setTag('repoId', repoId);
	if (sessionId) Sentry.setTag('sessionId', sessionId);
	if (machineId) Sentry.setTag('machineId', machineId);
}

/**
 * Add a breadcrumb for lifecycle events.
 * @param {string} category
 * @param {string} message
 * @param {'info'|'warning'|'error'} [level='info']
 * @param {object} [data]
 */
export function addBreadcrumb(category, message, level = 'info', data) {
	Sentry.addBreadcrumb({
		category,
		message,
		level,
		data,
		timestamp: Date.now() / 1000,
	});
}

/**
 * Capture an exception with optional extra context.
 * @param {Error} error
 * @param {{ source?: string, extras?: object }} [context]
 */
export function captureException(error, context) {
	Sentry.withScope((scope) => {
		if (context?.source) scope.setTag('source', context.source);
		if (context?.extras) scope.setExtras(context.extras);
		Sentry.captureException(error);
	});
}

/**
 * Graceful shutdown — flush pending events.
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<boolean>}
 */
export function shutdownSentry(timeoutMs = 2000) {
	if (!initialized) return Promise.resolve(true);
	return Sentry.close(timeoutMs);
}

/**
 * Wire process-level crash handlers.
 * Call once after initSentry().
 */
export function wireCrashHandlers() {
	process.on('uncaughtException', (error) => {
		Sentry.captureException(error);
		Sentry.close(2000).then(() => process.exit(1)).catch(() => process.exit(1));
	});

	process.on('unhandledRejection', (reason) => {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		Sentry.captureException(error);
	});
}
