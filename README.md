# LocalBridge

**LocalBridge** is a VS Code extension that turns the folder you have open in the editor into a **remote MCP server** your AI tools can call safely. The model stays in Claude, ChatGPT, or another MCP client; **your code, terminal, git state, and diagnostics stay on your machine**. LocalBridge handles authentication, workspace boundaries, sensitive-file rules, and VS Code approval dialogs before anything destructive runs.

**Product site and connection guides:** [https://localbridge.widgetkraft.com](https://localbridge.widgetkraft.com)

Install it from the VS Code Marketplace.

> **Local-first:** LocalBridge is a **free VS Code extension**. There is **no LocalBridge backend server**—the MCP server runs inside VS Code on your computer, your project files stay on disk, and tools execute in your workspace. Remote AI clients only talk to **your machine** (localhost, or an optional tunnel you configure). The **LocalBridge MCP token** and **ngrok authtoken** are stored in **VS Code SecretStorage** on your system.

---

## What it is for

Use LocalBridge when you want an AI agent to:

- Read and edit project files **in the repo you already opened in VS Code**
- Run **tests and shell commands** in that workspace (with limits and approval where needed)
- Inspect **git status/diff**, **editor context**, and **language diagnostics**
- Hit **local dev servers** (localhost HTTP) while you iterate
- Share **project context** across sessions or different agents (`get_project_context` / `update_project_context`)

LocalBridge is **not** a cloud IDE. The MCP server listens on **localhost**; optional **ngrok** or **Cloudflare quick tunnel** exposes it over HTTPS so remote MCP clients (e.g. Claude in the browser) can reach your machine.

---

## How connection works

```
MCP client (Claude, ChatGPT, …)
        │  HTTPS + LocalBridge token
        ▼
Public tunnel (optional)     or     http://127.0.0.1:<port>/mcp
        │
        ▼
LocalBridge MCP server in VS Code
        │  auth → workspace checks → permissions → tools
        ▼
Your workspace folder(s)
```

1. **Open a folder** in VS Code (a real project workspace).
2. Open the **LocalBridge** activity bar sidebar.
3. Complete setup if prompted, then click **Start** (connections are **not** auto-started when you only open the sidebar).
4. Copy the MCP endpoint:
   - **LocalBridge: Copy MCP Endpoint (with token, for Claude)** — full URL including `access_token` (best for Claude and ChatGPT).
   - Or **Copy MCP Endpoint** + **Copy MCP Authentication Token** and combine manually.
5. In your MCP client, add a **remote HTTP** connector using **No sign-in / No OAuth** and paste the **full URL with token**. Step-by-step for each client is on [localbridge.widgetkraft.com](https://localbridge.widgetkraft.com).

### Credentials

| Credential | Purpose | Storage |
|------------|---------|---------|
| **LocalBridge MCP token** (`local_…`) | Authenticates every `/mcp` request. Required when `localbridge.mcp.requireAuth` is true (default). | VS Code **SecretStorage** |
| **ngrok authtoken** (optional) | Authenticates the ngrok agent when you enable a public HTTPS tunnel. | VS Code **SecretStorage** (command **LocalBridge: Configure ngrok**) or settings/env—see below |

Send the MCP token via **URL query** `access_token=…`, **`Authorization: Bearer`**, or **`X-LocalBridge-Token`**.

Treat the MCP token like a password—especially in URLs (history, logs, screenshots).

### Public HTTPS tunnels

Enable **`localbridge.ngrok.enabled`** when you need a URL reachable from the internet (typical for Claude/ChatGPT remote MCP).

**ngrok (default provider)**

- Set your authtoken via **LocalBridge: Configure ngrok** (recommended—it saves to SecretStorage), setting **`localbridge.ngrok.authtoken`**, or `NGROK_AUTHTOKEN` before starting VS Code.
- **Static URL every time:** reserve a domain in the [ngrok dashboard](https://dashboard.ngrok.com/domains), then set **`localbridge.ngrok.domain`** (or `NGROK_DOMAIN`) to e.g. `your-name.ngrok-free.app`. LocalBridge reuses that host on each start; if binding fails, it falls back to a random ngrok URL and shows a warning.

**Cloudflare quick tunnel**

- Set **`localbridge.public.provider`** to **`cloudflare`**.
- **`cloudflared` must be installed on your system** (the extension does not bundle the CLI for quick tunnels).

  **Windows**

  ```powershell
  winget install --id Cloudflare.cloudflared
  ```

  **macOS**

  ```bash
  brew install cloudflared
  ```

- After installing, **restart VS Code** so LocalBridge can find `cloudflared` on your PATH (or set **`localbridge.cloudflared.path`** to the full executable path).

---

## MCP tools (29)

All tools operate on the **authorized workspace** unless noted. File mutations and many commands require **explicit approval in VS Code**.

### Files and directories

| Tool | Description |
|------|-------------|
| `read_file` | Read a workspace-relative file (sensitive paths prompt first). |
| `search_file` | Search file contents; sensitive paths excluded from whole-repo search. |
| `write_file` | Replace an existing file (always prompts). |
| `create_file` | Create a new file (prompts). |
| `delete_file` | Delete a file (prompts). |
| `create_directory` | Create a directory (prompts). |
| `delete_directory` | Delete a directory tree (high-risk prompt; `.git` blocked). |

### Git (read-only)

| Tool | Description |
|------|-------------|
| `git_status` | Porcelain-style status summary. |
| `git_branch` | Current branch and upstream. |
| `git_diff` | Bounded diff; sensitive paths need read approval. |
| `git_log` | Recent commits (oneline). |
| `git_show` | Show a revision (default `HEAD`). |
| `git_staged_diff` | Diff of staged changes. |

### Shared context

| Tool | Description |
|------|-------------|
| `get_project_context` | Load agent-independent project notes stored by LocalBridge. |
| `update_project_context` | Update summary, tasks, todos, conventions, etc. |

### Execution and processes

| Tool | Description |
|------|-------------|
| `run_command` | Run a finite shell command in the workspace (timeout, bounded output). |
| `start_process` | Start a long-running managed process. |
| `read_process_output` | Read stdout/stderr from a managed process. |
| `send_process_input` | Write to process stdin when supported. |
| `stop_process` | Graceful stop (optional force). |
| `list_processes` | List LocalBridge-managed processes only. |
| `read_terminal` | Recent output from managed processes (not arbitrary VS Code terminals). |

### Diagnostics, tests, runtime

| Tool | Description |
|------|-------------|
| `get_diagnostics` | VS Code language diagnostics for workspace files. |
| `run_tests` | Detect project type and run tests (npm/pytest/go/cargo/etc.; no auto-install). |
| `list_local_servers` | Ports inferred from managed process output (no wide port scan). |
| `http_request` | HTTP to **localhost only** (prompt + size limits). |
| `get_environment` | Safe metadata (OS, Node version, etc.—**not** env var values). |

### Workspace awareness

| Tool | Description |
|------|-------------|
| `get_workspace_info` | Folders, detected project type, git summary. |
| `get_active_editor` | Active file, language, selection, cursor (workspace only). |

---

## Security model (summary)

- Paths are resolved under workspace roots with traversal and symlink checks.
- Sensitive files (e.g. `.env`, keys) use read/search/write rules in `sensitivePathDetector`.
- **Destructive file ops** and **risky commands** use centralized VS Code modals (`PermissionManager`).
- Command output is **size-limited** and **redacted** for common secret patterns.
- **Audit log** records operation metadata locally (no file contents)—**LocalBridge: View Audit Log**.

Details and client-specific connection troubleshooting: [localbridge.widgetkraft.com](https://localbridge.widgetkraft.com).

---

## VS Code commands

| Command | Purpose |
|---------|---------|
| LocalBridge: Start / Stop / Restart | Control the MCP server (and optional tunnel). |
| LocalBridge: Open / Show Connector | Open the connector panel. |
| LocalBridge: Copy MCP Endpoint | URL without token. |
| LocalBridge: Copy MCP Endpoint (with token, for Claude) | Full authenticated URL for MCP clients. |
| LocalBridge: Copy MCP Authentication Token | Token only. |
| LocalBridge: Regenerate Authentication Token | Invalidate old clients’ URLs. |
| LocalBridge: Configure ngrok | Store ngrok authtoken in SecretStorage. |
| LocalBridge: Open Settings | Extension settings. |
| LocalBridge: View / Clear Audit Log | Local operation history. |

Status bar shows **LocalBridge: Local** (localhost) or **Connected** (public tunnel). Click for the status menu.

---

## Settings worth knowing

| Setting | Default | Meaning |
|---------|---------|---------|
| `localbridge.mcp.requireAuth` | `true` | Require MCP token on `/mcp`. |
| `localbridge.ngrok.enabled` | `false` | When `true`, expose MCP via ngrok or Cloudflare (see `localbridge.public.provider`). |
| `localbridge.mcp.port` | `0` | Local port (`0` = automatic). |
| `localbridge.maxReadFileSize` / `maxWriteFileSize` | 5 MiB | File tool limits. |
| `localbridge.execution.defaultCommandTimeoutMs` | 120000 | Default `run_command` timeout. |

**ngrok authtoken:** **LocalBridge: Configure ngrok** (SecretStorage), `localbridge.ngrok.authtoken`, or `NGROK_AUTHTOKEN` before launching VS Code.

**ngrok static domain:** `localbridge.ngrok.domain` or `NGROK_DOMAIN` — same public MCP URL on every start (see [Public HTTPS tunnels](#public-https-tunnels)).

**Cloudflare:** `localbridge.public.provider` = `cloudflare`; install `cloudflared` and restart VS Code (see above).

---

## Output and support

- **Output** panel → channel **LocalBridge** for connection events (no file contents or tokens).
- Uninstalling runs cleanup of LocalBridge secrets and related user settings where possible.

For documentation and connector setup: **[https://localbridge.widgetkraft.com](https://localbridge.widgetkraft.com)**.
