# LocalBridge

LocalBridge is a **local-first** VS Code extension that exposes your **workspace** as an MCP server (HTTP + ngrok). AI clients (ChatGPT, Claude, others) are **untrusted**: every MCP request is authenticated, validated against workspace boundaries, classified for sensitivity, and (for mutations) approved in VS Code before any filesystem change.

## Architecture

```
VS Code Extension
│
├── Authentication Manager (MCP token in SecretStorage)
├── Security Engine (paths, symlinks, limits, binary detection)
├── Permission Engine (centralized VS Code prompts)
├── Context Engine (agent-independent project context)
├── Audit Engine (local metadata log)
├── Workspace Manager (multi-root)
├── Git Context Provider (read-only git tools)
├── MCP HTTP Server (/mcp)
└── ngrok Manager (optional public HTTPS)

ChatGPT / Claude / MCP client
        │  HTTPS + token (URL ?access_token=… and/or Bearer header)
        ▼
https://xxxxx.ngrok-free.app/mcp?access_token=local_…  (or http://127.0.0.1:<port>/mcp?…)
        │
        ▼
     ngrok tunnel (optional)
        │
        ▼
localhost MCP server → Security → Permissions → tools
        │
        ▼
Workspace folder(s)
```

### Credentials (two different tokens)

| Credential | Purpose |
|------------|---------|
| **ngrok authtoken** | Authenticates your ngrok agent/account for the tunnel |
| **LocalBridge MCP token** (`local_…`) | Authenticates HTTP requests to the local MCP server |

The LocalBridge MCP token is generated on first activation, stored in **VS Code SecretStorage**, and required on every `/mcp` request when `localbridge.mcp.requireAuth` is enabled (default).

Send the token in any of these ways:

| Method | Example |
|--------|---------|
| **URL query (best for ChatGPT & Claude)** | `https://host/mcp?access_token=local_…` |
| **Bearer header** | `Authorization: Bearer local_…` |
| **Custom header** | `X-LocalBridge-Token: local_…` |

Also accepted query names: `token`, `api_key`.

**Security warning:** The LocalBridge authentication token grants access to the local LocalBridge MCP server. Treat it like a password—especially in URLs (logs, history, screenshots). LocalBridge does not upload source code to a LocalBridge cloud service; there is no mandatory cloud account.

Commands:

- **LocalBridge: Copy Connector URL (with token, for Claude)** — full MCP URL with `access_token` (use for ChatGPT too)
- **LocalBridge: Copy MCP Authentication Token** — token only
- **LocalBridge: Regenerate Authentication Token**
- **LocalBridge: Configure ngrok** (stores ngrok token in SecretStorage)

### Permission model (summary)

| Operation | Normal | Sensitive |
|-----------|--------|-----------|
| read_file | automatic | ask |
| search_file | automatic (sensitive excluded) | ask if explicitly scoped |
| write_file | ask | ask + high-risk |
| create_file / create_directory | ask | ask + high-risk |
| delete_file | ask | ask + high-risk |
| delete_directory | ask + high-risk | ask + high-risk |

No filesystem mutation runs before user approval. Writes use SHA-256 conflict detection if the file changes while a prompt is open.

### MCP tool groups

- **FILE:** `read_file`, `search_file`, `write_file`, `create_file`, `delete_file`
- **DIRECTORY:** `create_directory`, `delete_directory`
- **GIT (read-only):** `git_status`, `git_diff`, `git_branch`
- **CONTEXT:** `get_project_context`, `update_project_context`

Project context is stored in extension global storage (not a copy of your repo), shared across agents.

## Connect ChatGPT and Claude

ChatGPT and Claude usually **do not** offer a separate “API key” field for custom MCP servers. LocalBridge auth is **not** OAuth—do not pick “Sign in” / OAuth flows. Put your stable `local_…` token in the **connector URL** and choose **no client-side sign-in**.

### 1. Copy the authenticated connector URL

1. Start LocalBridge (**LocalBridge: Start** or F5 with auto-start).
2. Command Palette → **LocalBridge: Copy Connector URL (with token, for Claude)**.
3. Confirm the warning. Your clipboard will contain something like:

```text
https://your-name.ngrok-free.app/mcp?access_token=local_xxxxxxxxxxxxxxxx
```

For localhost-only testing:

```text
http://127.0.0.1:54321/mcp?access_token=local_xxxxxxxxxxxxxxxx
```

The `access_token` value stays the same across restarts until you run **LocalBridge: Regenerate Authentication Token**. You configure the connector **once**, not every session.

To build the URL yourself: run **LocalBridge: Copy Connector URL** and **LocalBridge: Copy MCP Authentication Token**, then append:

```text
?access_token=<paste-token-here>
```

(URL-encode the token if it contains special characters.)

### 2. ChatGPT

ChatGPT’s MCP UI labels vary by plan; use the option that means **no OAuth / no sign-in** (often **No auth**).

1. Open **Settings** → **Developer** / **Apps & Connectors** (or your plan’s MCP area).
2. **Add** a custom MCP server / connector → type **HTTP** / **Remote**.
3. **Authentication:** **No auth** (do not use OAuth or “sign in with …”).
4. **Server URL:** paste the **entire** URL from step 1, including `?access_token=local_…`.
5. Save and enable the connector for a chat.

If the connector only has a URL field, the query parameter is how ChatGPT sends your LocalBridge token.

### 3. Claude

Claude’s connector check returns **401** if the URL has no token; the UI may then suggest **Sign in now** (OAuth). That does not apply to localbridge.

1. Add or edit your **custom connector** / remote MCP server.
2. **Authentication:** **No sign-in** (servers that use an API key in the URL instead of OAuth).
3. **Server URL:** paste the **entire** URL from step 1, including `?access_token=local_…`.
4. Save and reconnect.

Do **not** select **Sign in now** or **Sign in when needed** unless LocalBridge adds OAuth in the future.

### 4. Optional: Bearer header instead of URL

If your client exposes custom headers, you can use the plain URL (`…/mcp` without query) plus:

```http
Authorization: Bearer local_<your-token>
```

Get the token with **LocalBridge: Copy MCP Authentication Token**.

### 5. Fallback (less secure)

If a client cannot send the token in the URL or headers, set **`localbridge.mcp.requireAuth`** to **`false`** in VS Code Settings and use the plain connector URL with **No auth** / **No sign-in**. Prefer this only on **localhost**; a public ngrok URL without auth is open to anyone who discovers the URL.

## Requirements

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm
- [Visual Studio Code](https://code.visualstudio.com/)
- ngrok account + authtoken ([ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken))
- An MCP-capable client (for example ChatGPT with developer/custom MCP connector support)

## Install dependencies

```bash
npm install
```

## Compile

```bash
npm run compile
```

Watch mode (used by F5):

```bash
npm run watch
```

## Configure ngrok authtoken

LocalBridge uses the [`@ngrok/ngrok`](https://www.npmjs.com/package/@ngrok/ngrok) npm package (no separate ngrok CLI required for basic use). You must provide an authtoken.

**Important (F5 / Extension Development Host):** Setting `$env:NGROK_AUTHTOKEN` only in the **integrated terminal** does **not** pass the token to the extension. The Extension Host uses the environment from the **Cursor/VS Code app process** (or the F5 launch profile).

**Recommended for F5 development:**

1. Copy `.vscode/.env.example` → `.vscode/.env` in the **LocalBridge repo root** (same folder as `package.json`)
2. Put your token in `.vscode/.env` (gitignored)
3. Press **F5** — the extension loads that file from its **install path** (not from `test-project`, which is the opened workspace)

**Localhost fallback:** If ngrok is missing, misconfigured, or fails, LocalBridge still starts the MCP server and shows **`http://127.0.0.1:<port>/mcp`**. Status bar: **LocalBridge: Local**. Use `npm run test:mcp` or an MCP client on the same machine. ChatGPT on the internet still needs a working ngrok URL.

Alternatively, set **`localbridge.ngrok.authtoken`** in **User** or **Workspace** Settings (works in both normal and Extension Development Host windows).

### Option A — VS Code setting

In **Settings** → search `LocalBridge` → **Ngrok: Authtoken**, paste your token.

Or in `settings.json`:

```json
{
  "localbridge.ngrok.authtoken": "YOUR_NGROK_AUTHTOKEN"
}
```

### Option B — environment variable

Set `NGROK_AUTHTOKEN` before launching VS Code:

**Windows (PowerShell)**

```powershell
$env:NGROK_AUTHTOKEN = "YOUR_NGROK_AUTHTOKEN"
code .
```

**macOS / Linux**

```bash
export NGROK_AUTHTOKEN="YOUR_NGROK_AUTHTOKEN"
code .
```

### Static ngrok domain (optional)

To reuse the **same public URL** every time you start LocalBridge, reserve a domain in the [ngrok domains dashboard](https://dashboard.ngrok.com/domains) and add it to `.vscode/.env`:

```env
NGROK_DOMAIN=your-name.ngrok-free.app
```

You can also set **`localbridge.ngrok.domain`** in VS Code settings. Alias env var: `NGROK_STATIC_DOMAIN`.

LocalBridge binds that domain when starting ngrok. If it fails (domain not on your account, already in use, etc.), it **automatically falls back** to a random ngrok URL and shows a warning. Check the **LocalBridge** output channel for `ngrok domain mode: static` vs `ephemeral`.

Connector URL with a static domain:

```text
https://your-name.ngrok-free.app/mcp
```

### Install ngrok (optional CLI)

The extension embeds ngrok via npm. If tunnel startup fails, you can also install the ngrok agent from [ngrok.com/download](https://ngrok.com/download) for troubleshooting.

## Run the extension (F5)

1. Open this repository in VS Code.
2. Run **Developer: Run Extension** or press **F5**.
3. A new **Extension Development Host** window opens with `test-project/` loaded (configured in `.vscode/launch.json`).
4. LocalBridge auto-starts when a workspace is open (`localbridge.autoStart`, default `true`).
5. Status bar should show **LocalBridge: Connected** (if ngrok is configured).
6. Click the status bar item or run **LocalBridge: Show Connector** to see the public URL.

### Commands

| Command | ID |
|--------|-----|
| LocalBridge: Start | `localbridge.start` |
| LocalBridge: Stop | `localbridge.stop` |
| LocalBridge: Restart | `localbridge.restart` |
| LocalBridge: Copy Connector URL | `localbridge.copyConnectorUrl` |
| LocalBridge: Show Connector | `localbridge.showConnector` |

### Output log

View **Output** → channel **LocalBridge** for connection events (never logs file contents).

## MCP endpoint

- Local: `http://127.0.0.1:<port>/mcp`
- Public: `https://<ngrok-subdomain>.ngrok-free.app/mcp`

Transport: **MCP Streamable HTTP** (`StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`).

### MCP tools

| Tool | Arguments | Permission |
|------|-----------|------------|
| `read_file` | `path` | Auto for normal files; **ask** for sensitive / DB credential files |
| `search_file` | `query`, optional `path` | Auto; sensitive paths excluded (no search scope on `.env`, etc.) |
| `write_file` | `path`, `content` | **Always ask** before any write |
| `create_file` | `path`, `content` | Auto (creates parent folders if needed) |
| `delete_file` | `path` | **Always ask** before delete |
| `create_directory` | `path` | Auto (creates missing parents in one operation) |
| `delete_directory` | `path` | **Always ask**; high-risk if non-empty; `.git` blocked |

Permission dialogs use the connected MCP client name (e.g. ChatGPT, Claude, Gemini) from the MCP `initialize` handshake.

Mutations happen **only after** you approve in VS Code. If the file changes while a write dialog is open, the write is rejected. See `src/workspace/security.ts` and `src/security/permissionManager.ts`.

### Automated tests

```bash
npm test
npm run test:mcp
```

## Manual end-to-end test

### Step 1 — Open test workspace

The F5 launch profile opens `test-project/` automatically. To test manually: **File → Open Folder** → `test-project`.

### Step 2 — Run extension

Press **F5** from the main LocalBridge repo window.

### Step 3 — Connected status

Status bar: **LocalBridge: Connected**.

### Step 4 — Connect ChatGPT or Claude

Follow **[Connect ChatGPT and Claude](#connect-chatgpt-and-claude)**:

- Copy **LocalBridge: Copy Connector URL (with token, for Claude)**.
- **ChatGPT:** authentication **No auth**, URL with `?access_token=local_…`.
- **Claude:** authentication **No sign-in**, same full URL.

Plain URL without token (for reference only): `https://xxxxx.ngrok-free.app/mcp`.

If connection fails, see **Known limitations** (ngrok free tier interstitial).

### Step 5 — Test `read_file`

Prompt:

```text
Read src/hello.js from my connected repository.
```

Expected: MCP `read_file` returns the contents of `test-project/src/hello.js`.

### Step 6 — Test `search_file`

Prompt:

```text
Search the repository for "authenticate".
```

Expected: matches in `src/auth.js`.

### Step 7 — Test `write_file`

Prompt:

```text
Modify src/hello.js so hello() returns "Hello LocalBridge".
```

Expected: VS Code modal/diff preview → **Allow** → file updated on disk.

### Step 8 — Test sensitive `.env` read

Prompt:

```text
Read .env
```

Expected: **LocalBridge — Sensitive File Access** modal. Contents are **not** returned unless you choose **Allow Once**.

### Step 9 — Test `create_file` / `delete_file`

After connecting ChatGPT, use these prompts:

**Test A — normal read**

```text
Read src/hello.js
```

Expected: immediate response, no permission dialog.

**Test B — normal search**

```text
Search the repository for authenticate
```

Expected: immediate results from normal source files.

**Test C — write (permission before change)**

```text
Change hello() so it returns 'ChatGPT is updating the local code'.
```

Expected: **LocalBridge — File Modification** dialog while `src/hello.js` still has the old content on disk. Click **Allow**, then verify the file changed.

**Test D — sensitive read**

```text
Read .env
```

Expected: sensitive access dialog; no contents until **Allow Once**.

**Test E — create file**

```text
Create src/services/test_service.py containing a reusable test service.
```

Expected: **Create** dialog before the file exists (lists parent folders if needed). Click **Create**, then verify the file appears.

**Test F — delete file**

```text
Delete src/services/test_service.py
```

Expected: **DELETE FILE** confirmation before removal. Click **Cancel** first and verify the file remains; run again and click **DELETE FILE**.

### Directory / folder manual tests (ChatGPT)

**Test G — Create nested folder**

```text
Create a new folder called src/services/email/templates.
```

Expected: one **Create Folder(s)** permission dialog **before** any folder exists on disk. Approve and verify `src/services/email/templates` exists.

**Test H — Create nested file with new parents**

```text
Create src/services/email/email_service.py with a reusable EmailService class.
```

Expected: if parent folders are missing, the **Create** dialog lists directories that will be created. Nothing on disk until you approve.

**Test I — Deny nested creation**

Ask ChatGPT to create `src/test/a/b/c/test.py`, then click **Cancel**.

Expected: none of `src/test`, `src/test/a`, `src/test/a/b`, `src/test/a/b/c`, or the file exist.

**Test J — Delete empty folder**

```text
Delete src/services/email/templates.
```

Expected: **Delete Folder** confirmation before removal.

**Test K — Delete non-empty folder**

```text
Delete src/services/email.
```

Expected: **HIGH RISK** dialog listing contained paths/counts. Deny → tree remains. Approve → folder and contents removed.

**Test L — Protected `.git`**

```text
Delete the .git directory.
```

Expected: rejected immediately (`Deletion of the .git directory is disabled in localbridge.`). No override dialog.

## Local MCP smoke test (no VS Code)

Verifies `initialize`, `tools/list`, and `tools/call` against a minimal in-process server:

```bash
node scripts/mcp-smoke.mjs
```

## Project layout

```text
LocalBridge/
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── README.md
├── .vscode/launch.json
├── .vscode/tasks.json
├── src/
│   ├── extension.ts
│   ├── connectionService.ts
│   ├── logger.ts
│   ├── mcp/
│   ├── workspace/
│   ├── ngrok/
│   └── ui/
├── scripts/mcp-smoke.mjs
└── test-project/
```

## Known limitations (MVP)

- **Single-root workspace only** — uses the **first** folder in `vscode.workspace.workspaceFolders`.
- **No cloud backend**, auth, git, terminal, or indexing.
- **Write approval** is always required (including new files).
- **ngrok free** URLs may show a browser warning page for some clients; paid ngrok or custom domains may work better with automated clients.
- **`@ngrok/ngrok` native addon** is not bundled into `dist/extension.js`; it loads from `node_modules` at runtime (required for F5 / local install).
- ChatGPT MCP connector settings and supported protocol versions may vary by account/region.

## Security notes

- All paths are resolved under the workspace root (including symlink checks where possible).
- Sensitive file rules are centralized in `src/workspace/security.ts`.
- Logs do not include file contents or tokens.

## License

MIT (placeholder — adjust as needed for your use)
