import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
	extractPlanFromTranscript,
	readPlanFromFile,
	outputAllow,
	outputDeny,
	waitForCallback
} from '../review-plan.js';

describe('outputAllow', () => {
	test('writes correct allow decision JSON to stdout', () => {
		const chunks = [];
		const spy = spyOn(process.stdout, 'write').mockImplementation((data) => {
			chunks.push(data);
			return true;
		});

		outputAllow();

		const output = JSON.parse(chunks.join(''));
		expect(output).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PermissionRequest',
				decision: {
					behavior: 'allow'
				}
			}
		});

		spy.mockRestore();
	});
});

describe('outputDeny', () => {
	test('writes correct deny decision JSON with feedback', () => {
		const chunks = [];
		const spy = spyOn(process.stdout, 'write').mockImplementation((data) => {
			chunks.push(data);
			return true;
		});

		outputDeny('Needs more detail on error handling');

		const output = JSON.parse(chunks.join(''));
		expect(output).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PermissionRequest',
				decision: {
					behavior: 'deny',
					message: 'Needs more detail on error handling'
				}
			}
		});

		spy.mockRestore();
	});

	test('uses default message when no feedback provided', () => {
		const chunks = [];
		const spy = spyOn(process.stdout, 'write').mockImplementation((data) => {
			chunks.push(data);
			return true;
		});

		outputDeny();

		const output = JSON.parse(chunks.join(''));
		expect(output.hookSpecificOutput.decision.message).toBe('Plan rejected by reviewer.');

		spy.mockRestore();
	});
});

describe('extractPlanFromTranscript', () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'review-plan-test-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test('returns null for missing transcript path', () => {
		expect(extractPlanFromTranscript(null, tmpDir)).toBeNull();
		expect(extractPlanFromTranscript(undefined, tmpDir)).toBeNull();
	});

	test('returns null for non-existent transcript file', () => {
		expect(extractPlanFromTranscript('/nonexistent/path.jsonl', tmpDir)).toBeNull();
	});

	test('extracts plan from Write tool call to plan file', () => {
		const planContent = '# My Plan\n\n## Steps\n1. Do something';
		const transcript = [
			JSON.stringify({
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Write',
							input: {
								file_path: '/home/user/.claude/plans/my-plan.md',
								content: planContent
							}
						}
					]
				}
			})
		].join('\n');

		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, transcript);

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBe(planContent);
	});

	test('finds the last plan Write call when multiple exist', () => {
		const oldPlan = '# Old Plan';
		const newPlan = '# Updated Plan';
		const transcript = [
			JSON.stringify({
				message: {
					role: 'assistant',
					content: [{
						type: 'tool_use',
						name: 'Write',
						input: { file_path: '/tmp/plan.md', content: oldPlan }
					}]
				}
			}),
			JSON.stringify({
				message: {
					role: 'assistant',
					content: [{
						type: 'tool_use',
						name: 'Write',
						input: { file_path: '/tmp/plan.md', content: newPlan }
					}]
				}
			})
		].join('\n');

		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, transcript);

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBe(newPlan);
	});

	test('ignores non-plan Write calls', () => {
		const transcript = [
			JSON.stringify({
				message: {
					role: 'assistant',
					content: [{
						type: 'tool_use',
						name: 'Write',
						input: { file_path: '/tmp/readme.md', content: '# README' }
					}]
				}
			})
		].join('\n');

		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, transcript);

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBeNull();
	});

	test('ignores non-assistant messages', () => {
		const transcript = [
			JSON.stringify({
				message: {
					role: 'user',
					content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/tmp/plan.md', content: 'plan' } }]
				}
			})
		].join('\n');

		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, transcript);

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBeNull();
	});

	test('handles empty transcript', () => {
		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, '');

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBeNull();
	});

	test('handles malformed JSONL lines gracefully', () => {
		const planContent = '# Valid Plan';
		const transcript = [
			'not valid json',
			JSON.stringify({
				message: {
					role: 'assistant',
					content: [{
						type: 'tool_use',
						name: 'Write',
						input: { file_path: '/tmp/plan.md', content: planContent }
					}]
				}
			})
		].join('\n');

		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, transcript);

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBe(planContent);
	});

	test('matches .claude/plan path patterns', () => {
		const planContent = '# Plan in .claude';
		const transcript = [
			JSON.stringify({
				message: {
					role: 'assistant',
					content: [{
						type: 'tool_use',
						name: 'Write',
						input: { file_path: '/home/user/.claude/plan/implementation.md', content: planContent }
					}]
				}
			})
		].join('\n');

		const transcriptPath = join(tmpDir, 'transcript.jsonl');
		writeFileSync(transcriptPath, transcript);

		expect(extractPlanFromTranscript(transcriptPath, tmpDir)).toBe(planContent);
	});
});

describe('readPlanFromFile', () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'readplan-test-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test('reads plan from .claude/plan.md', () => {
		const planDir = join(tmpDir, '.claude');
		mkdirSync(planDir, { recursive: true });
		writeFileSync(join(planDir, 'plan.md'), '# Plan from .claude');

		expect(readPlanFromFile(tmpDir)).toBe('# Plan from .claude');
	});

	test('reads plan from plan.md in cwd', () => {
		writeFileSync(join(tmpDir, 'plan.md'), '# Plan from root');

		expect(readPlanFromFile(tmpDir)).toBe('# Plan from root');
	});

	test('prefers .claude/plan.md over plan.md', () => {
		const planDir = join(tmpDir, '.claude');
		mkdirSync(planDir, { recursive: true });
		writeFileSync(join(planDir, 'plan.md'), '# .claude plan');
		writeFileSync(join(tmpDir, 'plan.md'), '# root plan');

		expect(readPlanFromFile(tmpDir)).toBe('# .claude plan');
	});

	test('returns null when no plan file exists', () => {
		expect(readPlanFromFile(tmpDir)).toBeNull();
	});

	test('returns null for empty plan files', () => {
		writeFileSync(join(tmpDir, 'plan.md'), '   \n  \n  ');

		expect(readPlanFromFile(tmpDir)).toBeNull();
	});
});

describe('waitForCallback', () => {
	test('resolves on GET callback', async () => {
		const port = 0; // Let OS assign
		// We need to find the actual port, so we'll use the function differently
		// waitForCallback starts a server on the given port
		// Let's use a fixed high port
		const testPort = 19876 + Math.floor(Math.random() * 1000);

		const callbackPromise = waitForCallback(testPort, 5000);

		// Give server time to start
		await new Promise(r => setTimeout(r, 100));

		// Send GET callback
		await fetch(`http://localhost:${testPort}/callback?decision=allow&feedback=looks%20good`);

		const result = await callbackPromise;
		expect(result.decision).toBe('allow');
		expect(result.feedback).toBe('looks good');
	});

	test('resolves on POST callback', async () => {
		const testPort = 19876 + Math.floor(Math.random() * 1000);

		const callbackPromise = waitForCallback(testPort, 5000);
		await new Promise(r => setTimeout(r, 100));

		await fetch(`http://localhost:${testPort}/callback`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'decision=deny&feedback=needs+changes'
		});

		const result = await callbackPromise;
		expect(result.decision).toBe('deny');
		expect(result.feedback).toBe('needs changes');
	});

	test('rejects on timeout', async () => {
		const testPort = 19876 + Math.floor(Math.random() * 1000);

		await expect(waitForCallback(testPort, 200)).rejects.toThrow('Plan review timed out.');
	});

	test('POST callback includes chatContext', async () => {
		const testPort = 19876 + Math.floor(Math.random() * 1000);

		const callbackPromise = waitForCallback(testPort, 5000);
		await new Promise(r => setTimeout(r, 100));

		const chatContext = JSON.stringify([{ messageType: 'chat', senderName: 'Alice', content: 'LGTM' }]);
		await fetch(`http://localhost:${testPort}/callback`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `decision=allow&feedback=ok&chatContext=${encodeURIComponent(chatContext)}`
		});

		const result = await callbackPromise;
		expect(result.chatContext).toEqual([{ messageType: 'chat', senderName: 'Alice', content: 'LGTM' }]);
	});
});
