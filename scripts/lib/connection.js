import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

function configDir() { return process.env.LIGHTSPRINT_CONFIG_DIR || join(homedir(), '.lightsprint'); }
function connectionFile() { return join(configDir(), 'connection.json'); }

export function readConnection() {
	try {
		const f = connectionFile();
		if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf-8'));
	} catch { /* corrupted — treat as not connected */ }
	return null;
}

export function writeConnection(data) {
	const dir = configDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	const f = connectionFile();
	const tmp = f + '.' + randomBytes(4).toString('hex');
	writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
	renameSync(tmp, f);
}

export function clearConnection() {
	try { unlinkSync(connectionFile()); } catch { /* already gone */ }
}
