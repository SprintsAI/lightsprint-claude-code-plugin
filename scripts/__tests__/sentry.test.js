import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Track calls to Sentry SDK methods
const sentryMock = {
	init: mock(() => {}),
	setTag: mock(() => {}),
	setUser: mock(() => {}),
	addBreadcrumb: mock(() => {}),
	captureException: mock(() => {}),
	withScope: mock((cb) => cb({
		setTag: mock(() => {}),
		setExtras: mock(() => {}),
	})),
	close: mock(() => Promise.resolve(true)),
};

// Mock the @sentry/node module before importing sentry.js
mock.module('@sentry/node', () => sentryMock);

// Import after mock is set up
const { initSentry, setSentryContext, addBreadcrumb, captureException, shutdownSentry, _resetForTesting } = await import('../lib/sentry.js');

describe('sentry module', () => {
	beforeEach(() => {
		_resetForTesting();
		Object.values(sentryMock).forEach(fn => fn.mockClear?.());
	});

	test('initSentry calls Sentry.init with correct DSN and environment', () => {
		initSentry({ baseUrl: 'https://lightsprint.ai' });
		expect(sentryMock.init).toHaveBeenCalledTimes(1);
		const initArg = sentryMock.init.mock.calls[0][0];
		expect(initArg.dsn).toContain('sentry.io');
		expect(initArg.environment).toBe('production');
		expect(initArg.tracesSampleRate).toBe(0);
	});

	test('initSentry detects staging environment for localhost', () => {
		initSentry({ baseUrl: 'http://localhost:3000' });
		expect(sentryMock.init).toHaveBeenCalledTimes(1);
		const initArg = sentryMock.init.mock.calls[0][0];
		expect(initArg.environment).toBe('staging');
	});

	test('initSentry guards against double initialization', () => {
		initSentry({ baseUrl: 'https://lightsprint.ai' });
		initSentry({ baseUrl: 'http://localhost:3000' });
		expect(sentryMock.init).toHaveBeenCalledTimes(1);
	});

	test('setSentryContext calls setUser with hashed email and setTag for each field', () => {
		setSentryContext({
			email: 'test@example.com',
			repoId: 'repo-123',
			sessionId: 'session-abc',
			machineId: 'machine-xyz',
		});
		expect(sentryMock.setUser).toHaveBeenCalledTimes(1);
		const userArg = sentryMock.setUser.mock.calls[0][0];
		expect(userArg.email).toBe('test@example.com');
		expect(userArg.id).not.toBe('test@example.com');
		expect(userArg.id.length).toBe(16);

		const tagCalls = sentryMock.setTag.mock.calls.map(c => c[0]);
		expect(tagCalls).toContain('repoId');
		expect(tagCalls).toContain('sessionId');
		expect(tagCalls).toContain('machineId');
	});

	test('addBreadcrumb calls Sentry.addBreadcrumb with correct shape', () => {
		addBreadcrumb('websocket', 'Connected', 'info', { url: 'ws://test' });
		expect(sentryMock.addBreadcrumb).toHaveBeenCalledTimes(1);
		const arg = sentryMock.addBreadcrumb.mock.calls[0][0];
		expect(arg.category).toBe('websocket');
		expect(arg.message).toBe('Connected');
		expect(arg.level).toBe('info');
		expect(arg.data).toEqual({ url: 'ws://test' });
	});

	test('captureException calls Sentry.withScope and captureException', () => {
		const err = new Error('test error');
		captureException(err, { source: 'cc-daemon', extras: { attempt: 3 } });
		expect(sentryMock.withScope).toHaveBeenCalledTimes(1);
	});

	test('shutdownSentry calls Sentry.close', async () => {
		initSentry({ baseUrl: 'https://lightsprint.ai' });
		await shutdownSentry(1000);
		expect(sentryMock.close).toHaveBeenCalledWith(1000);
	});
});
