import { watch, statSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';

const TOOL_RESULT_MAX = 2048;
const TEXT_BLOCK_MAX = 50 * 1024;
const TRUNCATION_MARKER = ' [truncated]';

function filterRecord(record) {
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  if (record.isSidechain) return null;

  if (record.type === 'assistant' && record.message?.content) {
    const filtered = record.message.content
      .filter(block => block.type !== 'thinking')
      .map(block => {
        if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > TOOL_RESULT_MAX) {
          return { ...block, content: block.content.slice(0, TOOL_RESULT_MAX) + TRUNCATION_MARKER };
        }
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > TEXT_BLOCK_MAX) {
          return { ...block, text: block.text.slice(0, TEXT_BLOCK_MAX) + TRUNCATION_MARKER };
        }
        if (block.type === 'tool_use' && block.input) {
          const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
          if (inputStr.length > TEXT_BLOCK_MAX) {
            // Note: this intentionally changes input from object to truncated string
            return { ...block, input: inputStr.slice(0, TEXT_BLOCK_MAX) + TRUNCATION_MARKER };
          }
        }
        return block;
      });
    return { ...record, message: { ...record.message, content: filtered } };
  }

  return record;
}

export function createTailer(filePath, onRecord, onError) {
  let offset = 0;
  let partialLine = '';
  let fsWatcher = null;
  let pollInterval = null;
  let fileHandle = null;
  let stopped = false;
  let reading = false;

  // Resources from the file-not-yet-existing code path
  let dirWatcher = null;
  let dirCheckInterval = null;
  let waitTimeout = null;

  async function readNewLines() {
    if (reading) return;
    reading = true;
    try {
      if (!existsSync(filePath)) return;

      const stat = statSync(filePath);
      if (stat.size <= offset) return;

      if (!fileHandle) {
        fileHandle = await open(filePath, 'r');
      }

      const buf = Buffer.alloc(stat.size - offset);
      const { bytesRead } = await fileHandle.read(buf, 0, buf.length, offset);
      if (bytesRead === 0) return;

      offset += bytesRead;
      const chunk = partialLine + buf.slice(0, bytesRead).toString('utf8');
      const lines = chunk.split('\n');

      partialLine = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          const filtered = filterRecord(record);
          if (filtered) onRecord(filtered);
        } catch {
          // Skip malformed JSON lines
        }
      }
    } catch (err) {
      if (onError) onError(err);
    } finally {
      reading = false;
    }
  }

  function start() {
    stopped = false;

    if (existsSync(filePath)) {
      startWatching();
    } else {
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      waitTimeout = setTimeout(() => {
        if (dirWatcher) { try { dirWatcher.close(); } catch {} dirWatcher = null; }
        if (onError) onError(new Error('JSONL file did not appear within 30s'));
      }, 30000);

      try {
        dirWatcher = watch(dir, (eventType, filename) => {
          if (existsSync(filePath)) {
            clearTimeout(waitTimeout); waitTimeout = null;
            if (dirWatcher) { try { dirWatcher.close(); } catch {} dirWatcher = null; }
            startWatching();
          }
        });
      } catch {
        dirCheckInterval = setInterval(() => {
          if (existsSync(filePath)) {
            clearInterval(dirCheckInterval); dirCheckInterval = null;
            clearTimeout(waitTimeout); waitTimeout = null;
            startWatching();
          }
        }, 500);
      }
    }
  }

  function startWatching() {
    readNewLines();

    try {
      fsWatcher = watch(filePath, () => {
        if (!stopped) readNewLines();
      });
    } catch {
      // fs.watch may fail — fall through to polling
    }

    pollInterval = setInterval(() => {
      if (!stopped) readNewLines();
    }, 5000);
  }

  function stop() {
    stopped = true;
    if (fsWatcher) { try { fsWatcher.close(); } catch {} fsWatcher = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (dirWatcher) { try { dirWatcher.close(); } catch {} dirWatcher = null; }
    if (dirCheckInterval) { clearInterval(dirCheckInterval); dirCheckInterval = null; }
    if (waitTimeout) { clearTimeout(waitTimeout); waitTimeout = null; }
    if (fileHandle) { try { fileHandle.close(); } catch {} fileHandle = null; }
    partialLine = '';
  }

  return { start, stop };
}
