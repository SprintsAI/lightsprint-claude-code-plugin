import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JsonlTailer', () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tailer-test-'));
    filePath = join(dir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads existing lines from beginning of file', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, timestamp: '2026-01-01T00:00:01Z' },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(2);
    expect(received[0].uuid).toBe('u1');
    expect(received[1].uuid).toBe('a1');
  });

  test('filters out file-history-snapshot and progress types', async () => {
    const lines = [
      { type: 'file-history-snapshot', uuid: 'fh1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'progress', uuid: 'p1', timestamp: '2026-01-01T00:00:01Z' },
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:02Z' },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
    expect(received[0].uuid).toBe('u1');
  });

  test('skips sidechain messages', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', isSidechain: false, message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', uuid: 'a1', isSidechain: true, message: { role: 'assistant', content: [] }, timestamp: '2026-01-01T00:00:01Z' },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
  });

  test('strips thinking blocks from assistant messages', async () => {
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'long internal thought...' },
            { type: 'text', text: 'visible response' },
          ],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
    const content = received[0].message.content;
    expect(content.length).toBe(1);
    expect(content[0].type).toBe('text');
  });

  test('truncates tool_result blocks exceeding 2KB', async () => {
    const bigContent = 'x'.repeat(3000);
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_result', content: bigContent },
            { type: 'text', text: 'ok' },
          ],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    const toolResult = received[0].message.content.find(b => b.type === 'tool_result');
    expect(toolResult.content.length).toBeLessThanOrEqual(2048 + 12); // 2KB + "[truncated]"
  });

  test('handles partial lines at EOF', async () => {
    writeFileSync(filePath, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    appendFileSync(filePath, '{"type":"user","uuid":"u2","mess');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));

    expect(received.length).toBe(1); // Only first complete line

    appendFileSync(filePath, 'age":{"role":"user","content":"second"},"timestamp":"2026-01-01T00:00:01Z"}\n');
    await new Promise(r => setTimeout(r, 200));
    tailer.stop();

    expect(received.length).toBe(2);
    expect(received[1].uuid).toBe('u2');
  });

  test('picks up new lines appended after start', async () => {
    writeFileSync(filePath, '');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 50));

    appendFileSync(filePath, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'late' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    await new Promise(r => setTimeout(r, 200));
    tailer.stop();

    expect(received.length).toBe(1);
  });

  test('truncates tool_use object input exceeding 50KB', async () => {
    // Build an object input that serializes to > 50KB
    const bigValue = 'z'.repeat(60000);
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/tmp/f.txt', content: bigValue } },
          ],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    expect(received.length).toBe(1);
    const toolUse = received[0].message.content[0];
    // input should now be a truncated string, not the original object
    expect(typeof toolUse.input).toBe('string');
    expect(toolUse.input.length).toBeLessThanOrEqual(50 * 1024 + 12);
    expect(toolUse.input.endsWith(' [truncated]')).toBe(true);
  });

  test('picks up file that appears after start', async () => {
    // Don't create the file yet
    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 50));

    // Now create the file with content
    writeFileSync(filePath, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'appeared' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    await new Promise(r => setTimeout(r, 300));
    tailer.stop();

    expect(received.length).toBe(1);
    expect(received[0].uuid).toBe('u1');
  });

  test('caps text blocks at 50KB', async () => {
    const bigText = 'y'.repeat(60000);
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: bigText }],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const { createTailer } = await import('../lib/jsonl-tailer.js');
    const received = [];
    const tailer = createTailer(filePath, (record) => received.push(record));
    tailer.start();
    await new Promise(r => setTimeout(r, 100));
    tailer.stop();

    const textBlock = received[0].message.content[0];
    expect(textBlock.text.length).toBeLessThanOrEqual(50 * 1024 + 12);
  });
});
