import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from 'http';

describe('daemon /error endpoint', () => {
	let server;
	let port;
	let capturedErrors = [];
	const DAEMON_AUTH_TOKEN = 'test-token-123';

	beforeAll(async () => {
		server = createServer(async (req, res) => {
			if (req.url === '/error' && req.method === 'POST') {
				const authHeader = req.headers['authorization'];
				const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
				if (providedToken !== DAEMON_AUTH_TOKEN) {
					res.writeHead(401, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
					return;
				}
				let body = '';
				req.on('data', chunk => body += chunk);
				req.on('end', () => {
					const data = JSON.parse(body);
					capturedErrors.push(data);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: true }));
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});

		port = await new Promise((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(server.address().port));
		});
	});

	afterAll(() => { server.close(); });

	test('accepts error report with valid auth', async () => {
		const resp = await fetch(`http://127.0.0.1:${port}/error`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${DAEMON_AUTH_TOKEN}`,
			},
			body: JSON.stringify({
				source: 'cc-event',
				error: 'TypeError',
				message: 'Cannot read property',
				stack: 'TypeError: Cannot read property\n    at ...',
				context: {},
			}),
		});
		expect(resp.status).toBe(200);
		expect(capturedErrors.length).toBeGreaterThan(0);
		expect(capturedErrors[capturedErrors.length - 1].source).toBe('cc-event');
	});

	test('rejects error report without auth', async () => {
		const resp = await fetch(`http://127.0.0.1:${port}/error`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ source: 'cc-event', error: 'Error', message: 'test' }),
		});
		expect(resp.status).toBe(401);
	});

	test('rejects error report with wrong token', async () => {
		const resp = await fetch(`http://127.0.0.1:${port}/error`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong-token' },
			body: JSON.stringify({ source: 'cc-event', error: 'Error', message: 'test' }),
		});
		expect(resp.status).toBe(401);
	});
});
