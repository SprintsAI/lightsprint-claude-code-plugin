# Local Testing Guide

How to test the Lightsprint Claude Code plugin end-to-end on your machine.

---

## 1. Prerequisites

- **Bun** (runtime + test runner + compiler)
- **Docker** (for Postgres + Redis)
- **Node.js >= 18** (for built-in `fetch`)
- **Claude Code** CLI installed
- Both repos cloned side-by-side:
  ```
  lightsprint-projects/
  ├── lightsprint/                    # Server
  └── lightsprint-claude-code-plugin/ # Plugin (this repo)
  ```

---

## 2. Start the Lightsprint Server Locally

### 2a. Start Postgres + Redis

```bash
cd lightsprint/app
docker compose up -d
```

This starts:
- **Postgres** on `localhost:5434` (user: `aipm`, password: `aipm_dev_password`, db: `ai_pm_dev`)
- **Redis** on `localhost:6380`

### 2b. Configure environment

```bash
cd lightsprint/app
cp .env.example .env
```

Edit `.env` — the minimum required values:

```env
DATABASE_URL=postgresql://aipm:aipm_dev_password@localhost:5434/ai_pm_dev
AUTH_SECRET=<run: openssl rand -hex 32>
REDIS_URL=redis://localhost:6380
APP_URL=http://localhost:5173

# GitHub App — create one at https://github.com/settings/apps
# Set the callback URL to http://localhost:5173/auth/callback/github
GITHUB_APP_ID=<your-app-id>
GITHUB_APP_CLIENT_ID=<your-client-id>
GITHUB_APP_CLIENT_SECRET=<your-client-secret>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=<any-secret>
GITHUB_APP_SLUG=<your-app-slug>
```

### 2c. Run migrations and start the server

```bash
cd lightsprint/app
bun install
bun run db:migrate:runtime   # apply database migrations
bun run dev                  # starts on http://localhost:5173
```

Verify: open http://localhost:5173 in your browser — you should see the login page.

---

## 3. Build & Install the Plugin Locally

### 3a. Install from source (development mode)

```bash
cd lightsprint-claude-code-plugin
LIGHTSPRINT_LOCAL_PATH=$(pwd) npx lightsprint
```

This:
- Compiles the binary with `bun build --compile`
- Copies it to `~/.local/bin/lightsprint`
- Symlinks the plugin into `~/.claude/plugins/marketplaces/lightsprint`
- Registers hooks with Claude Code automatically

### 3b. Point the plugin at your local server

```bash
export LIGHTSPRINT_BASE_URL=http://localhost:5173
```

Or set it permanently in `~/.lightsprint/config.json`:

```json
{
  "baseUrl": "http://localhost:5173"
}
```

---

## 4. Connect the Plugin to Your Local Server

### 4a. Automatic (via Claude Code)

Start Claude Code in a git repo with a GitHub remote, then run any lightsprint skill:

```
/lightsprint:tasks
```

This triggers the OAuth flow:
1. Opens browser to `http://localhost:5173/authorize-cli?port=...&repo=owner/repo`
2. You log in and select a Lightsprint repo
3. Callback sends tokens back to the CLI
4. Tokens are saved to `~/.lightsprint/repos.json`

### 4b. Manual (skip OAuth)

If you need to bypass the browser flow (e.g., headless environment), manually create `~/.lightsprint/repos.json`:

```json
{
  "YourGitHubOrg/your-repo": {
    "accessToken": "<get from browser devtools after login>",
    "refreshToken": "<from the same OAuth response>",
    "expiresAt": 9999999999999,
    "repoId": "<your lightsprint repo ID>",
    "repoName": "Your Repo",
    "baseUrl": "http://localhost:5173"
  }
}
```

You can find the repo ID from the Lightsprint web UI URL: `http://localhost:5173/repos/<repoId>`.

---

## 5. Test the Plugin

### 5a. Automated tests (no server needed)

All unit/integration/E2E tests use mock servers — no real Lightsprint instance required:

```bash
cd lightsprint-claude-code-plugin

# Run all tests
bun test

# Run only E2E tests (mock server, session lifecycle, plan review)
bun test scripts/__tests__/e2e-mock-server.test.js

# Run a specific test by name
bun test --test-name-pattern "plan review"

# Run unit tests only
bun test scripts/__tests__/validate-id.test.js
bun test scripts/__tests__/client-resilience.test.js
```

### 5b. Manual testing against local server

Open Claude Code in a connected repo and test each flow:

**Task management:**
```
/lightsprint:tasks                          # list tasks
/lightsprint:create                         # create a task
/lightsprint:get                            # get task details
/lightsprint:claim                          # claim a task
/lightsprint:update                         # update status/title
/lightsprint:comment                        # add a comment
```

**Session lifecycle** — verify daemon starts and connects:
```bash
# In a separate terminal, tail the logs:
tail -f ~/.lightsprint/daemon.log

# Start Claude Code — you should see:
#   [cc-start] Spawning daemon ...
#   [cc-daemon] HTTP server started { port: ... }
#   [cc-daemon] WebSocket connected
#   [cc-daemon] Session started { lsSessionId: ... }
```

**Plan review** — verify the ExitPlanMode hook:
1. In Claude Code, enter plan mode (the agent writes a plan)
2. When the agent exits plan mode, the hook fires
3. Browser should open to the plan review page on your local server
4. Approve or reject — decision flows back to Claude Code

### 5c. CLI testing (without Claude Code)

Test CLI commands directly:

```bash
# From the plugin repo root (source mode)
bun run scripts/lightsprint.js tasks --output json
bun run scripts/lightsprint.js whoami
bun run scripts/lightsprint.js create --title "Test task" --dry-run --output json
bun run scripts/lightsprint.js get --task <task-id> --output json

# Or using the compiled binary
lightsprint tasks --output json
```

---

## 6. Debugging

### Log files

```bash
tail -f ~/.lightsprint/daemon.log    # daemon + WS connection
tail -f ~/.lightsprint/sync.log      # plan review hook
```

### Isolated config dir (for testing without affecting real config)

```bash
export LIGHTSPRINT_CONFIG_DIR=/tmp/lightsprint-dev
mkdir -p /tmp/lightsprint-dev

# Create repos.json in the isolated dir
cat > /tmp/lightsprint-dev/repos.json << 'EOF'
{
  "YourOrg/your-repo": {
    "accessToken": "your-token",
    "refreshToken": "your-refresh-token",
    "expiresAt": 9999999999999,
    "repoId": "your-repo-id",
    "baseUrl": "http://localhost:5173"
  }
}
EOF

# Now all plugin operations use /tmp/lightsprint-dev instead of ~/.lightsprint
bun run scripts/lightsprint.js tasks --output json
```

### Daemon not connecting?

1. Check if the daemon process is running: `ps aux | grep cc-daemon`
2. Check the session state file: `cat ~/.lightsprint/cc-sessions/*.json`
3. Hit the daemon health endpoint: `curl http://127.0.0.1:<port>/health`
4. Check if the WebSocket URL is correct in the logs — should be `ws://localhost:5173/cc-ws?token=...`

### Rebuild after code changes

```bash
# If testing from source (bun run), no rebuild needed — changes are live

# If testing with the compiled binary, rebuild:
npm run build
```

---

## 7. Architecture Reference

```
Claude Code
  │
  ├── SessionStart hook ──→ cc-start.js ──→ spawns cc-daemon
  │                                              │
  │                                              ├── HTTP server (localhost:PORT)
  │                                              │     /health
  │                                              │     /event
  │                                              │     /review-plan
  │                                              │     /session-end
  │                                              │
  │                                              └── WebSocket ──→ Lightsprint /cc-ws
  │                                                    session:start
  │                                                    events (streamed)
  │                                                    session:end
  │
  ├── UserPromptSubmit hook ──→ cc-event.js ──→ POST /event to daemon
  │
  ├── ExitPlanMode hook ──→ cc-review.js ──→ POST /review-plan to daemon
  │                                              │
  │                                              ├── Upload plan to API
  │                                              ├── Open browser for review
  │                                              ├── Wait for callback (blocks)
  │                                              └── Return allow/deny
  │
  ├── SessionEnd hook ──→ cc-end.js ──→ POST /session-end to daemon
  │
  └── Skills (/lightsprint:*) ──→ ls-cli.js ──→ REST API calls
                                                  /api/repos/{id}/tasks
                                                  /api/tasks/{id}
                                                  /api/tasks/{id}/claim
                                                  /api/tasks/{id}/comments
                                                  /api/repos/{id}/plans
```
