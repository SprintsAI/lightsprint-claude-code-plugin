#!/usr/bin/env node
import { execSync } from "node:child_process";

const REPO = "SprintsAI/lightsprint-claude-code-plugin";
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
