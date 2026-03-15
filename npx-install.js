#!/usr/bin/env node
import { execSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO = "SprintsAI/lightsprint-claude-code-plugin";
const BINARY = join(homedir(), ".local", "bin", "lightsprint");

// If args were passed (e.g. `npx lightsprint status`), run the installed binary
// instead of triggering a full reinstall.
const args = process.argv.slice(2);
if (args.length > 0) {
  if (!existsSync(BINARY)) {
    console.error(
      "Lightsprint CLI is not installed. Run `npx lightsprint` (with no arguments) to install it first."
    );
    process.exit(1);
  }
  try {
    execFileSync(BINARY, args, { stdio: "inherit" });
  } catch (e) {
    process.exit(e.status || 1);
  }
  process.exit(0);
}

// No args — run the installer
const url = `https://raw.githubusercontent.com/${REPO}/main/install.sh`;
console.log("Installing Lightsprint for Claude Code...\n");

try {
  execSync(`curl -fsSL "${url}" | bash`, {
    stdio: "inherit",
    shell: true,
  });
} catch (e) {
  process.exit(e.status || 1);
}
