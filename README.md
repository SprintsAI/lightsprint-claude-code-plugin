# Lightsprint Claude Code Plugin

Claude Code plugin for Lightsprint — plan review, task management skills, and project board integration.

## Prerequisites

- **Claude Code** CLI installed
- A **Lightsprint project** at [lightsprint.ai](https://lightsprint.ai)

## Quick Start

Install the plugin (one time):

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash
```

### Non-interactive install

If you're installing from a non-interactive environment (e.g., Claude Code, CI, or a script), download the installer and pipe `yes` to auto-confirm all prompts:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh)" <<< $'Y\nY'
```

---

## Staging Use

To connect the plugin to a staging Lightsprint instance, set the base URL during install:

```bash
LIGHTSPRINT_BASE_URL=https://staging.lightsprint.ai \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh)"
```

Or pass it as a flag:

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/install.sh | bash -s -- --base-url=https://staging.lightsprint.ai
```

You can also switch an existing installation to staging by reconnecting:

```bash
lightsprint connect --base-url https://staging.lightsprint.ai
```

The base URL is persisted in `~/.lightsprint/config.json` and used for all subsequent API calls and OAuth flows.

---

## Local Development

To install the plugin from a local checkout (instead of downloading from GitHub releases):

```bash
LIGHTSPRINT_LOCAL_PATH=/path/to/lightsprint-claude-code-plugin \
  bash install.sh
```

This will:

1. **Compile the binary from source** using Bun (must be installed)
2. **Symlink** the local checkout into the plugin directory instead of downloading from the marketplace
3. Copy the compiled binary to `~/.local/bin/` for CLI convenience

You can combine local development with a custom base URL:

```bash
LIGHTSPRINT_LOCAL_PATH=. LIGHTSPRINT_BASE_URL=http://localhost:5173 bash install.sh
```

After making changes to source files, re-run the install to recompile:

```bash
LIGHTSPRINT_LOCAL_PATH=. bash install.sh
```

> **Note:** Local dev mode requires [Bun](https://bun.sh). Windows (`install.ps1`) does not support local dev mode.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/SprintsAI/lightsprint-claude-code-plugin/main/uninstall.sh | bash
```

This removes the plugin from Claude Code and deletes the authorization for the current folder. Other folders' authorizations in `~/.lightsprint/projects.json` are preserved.

---

## Troubleshooting

`tail -f ~/.lightsprint/daemon.log ~/.lightsprint/sync.log`