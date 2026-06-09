import { describe, test, expect } from 'bun:test';
import { decodeWorkspaceRepos } from '../lib/auth.js';

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

describe('decodeWorkspaceRepos', () => {
	test('returns null for missing input', () => {
		expect(decodeWorkspaceRepos(null)).toBeNull();
		expect(decodeWorkspaceRepos(undefined)).toBeNull();
		expect(decodeWorkspaceRepos('')).toBeNull();
	});

	test('returns null for malformed base64/json', () => {
		expect(decodeWorkspaceRepos('not-base64-json!!')).toBeNull();
		expect(decodeWorkspaceRepos(Buffer.from('{not json').toString('base64url'))).toBeNull();
	});

	test('returns null when payload is not an array', () => {
		expect(decodeWorkspaceRepos(encode({ fullName: 'a/b', accessToken: 't' }))).toBeNull();
	});

	test('decodes a valid array of repo bundles', () => {
		const bundles = [
			{ repoId: 'r1', repo: 'frontend', fullName: 'org/frontend', workspaceId: 'ws1', accessToken: 'lsat_1', refreshToken: 'lsrt_1', expiresIn: 3600 },
			{ repoId: 'r2', repo: 'backend', fullName: 'org/backend', workspaceId: 'ws1', accessToken: 'lsat_2', refreshToken: 'lsrt_2', expiresIn: 3600 },
		];
		const decoded = decodeWorkspaceRepos(encode(bundles));
		expect(decoded).toHaveLength(2);
		expect(decoded.map((b) => b.fullName)).toEqual(['org/frontend', 'org/backend']);
		expect(decoded[1].repoId).toBe('r2');
	});

	test('filters out bundles missing fullName or accessToken', () => {
		const bundles = [
			{ repoId: 'r1', fullName: 'org/frontend', accessToken: 'lsat_1', expiresIn: 3600 },
			{ repoId: 'r2', fullName: null, accessToken: 'lsat_2', expiresIn: 3600 }, // no fullName
			{ repoId: 'r3', fullName: 'org/x', accessToken: '', expiresIn: 3600 },    // no token
		];
		const decoded = decodeWorkspaceRepos(encode(bundles));
		expect(decoded).toHaveLength(1);
		expect(decoded[0].fullName).toBe('org/frontend');
	});

	test('returns null when every bundle is invalid', () => {
		const bundles = [{ repoId: 'r2', fullName: null, accessToken: 'lsat_2' }];
		expect(decodeWorkspaceRepos(encode(bundles))).toBeNull();
	});
});
