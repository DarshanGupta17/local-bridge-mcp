# RepoBridge (MVP)

RepoBridge is a VS Code extension that exposes your **currently opened workspace folder** as a **remote MCP server** over HTTPS using **ngrok**. External MCP clients (for example ChatGPT with custom MCP support) can read, search, and propose edits to local files—with **VS Code permission dialogs** before sensitive reads/writes and before normal file writes.

```
ChatGPT / MCP client
        │  MCP over HTTPS
        ▼
https://xxxxx.ngrok-free.app/mcp
        │
        ▼
     ngrok tunnel
        │
        ▼
localhost MCP HTTP server (Streamable HTTP)
        │
        ▼
RepoBridge VS Code extension
        │
        ▼
Your workspace folder
```

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

RepoBridge uses the [`@ngrok/ngrok`](https://www.npmjs.com/package/@ngrok/ngrok) npm package (no separate ngrok CLI required for basic use). You must provide an authtoken.

**Important (F5 / Extension Development Host):** Setting `$env:NGROK_AUTHTOKEN` only in the **integrated terminal** does **not** pass the token to the extension. The Extension Host uses the environment from the **Cursor/VS Code app process** (or the F5 launch profile).

**Recommended for F5 development:**

1. Copy `.vscode/.env.example` → `.vscode/.env` in the **RepoBridge repo root** (same folder as `package.json`)
2. Put your token in `.vscode/.env` (gitignored)
3. Press **F5** — the extension loads that file from its **install path** (not from `test-project`, which is the opened workspace)

**Localhost fallback:** If ngrok is missing, misconfigured, or fails, RepoBridge still starts the MCP server and shows **`http://127.0.0.1:<port>/mcp`**. Status bar: **RepoBridge: Local**. Use `npm run test:mcp` or an MCP client on the same machine. ChatGPT on the internet still needs a working ngrok URL.

Alternatively, set **`repobridge.ngrok.authtoken`** in **User** or **Workspace** Settings (works in both normal and Extension Development Host windows).

### Option A — VS Code setting

In **Settings** → search `RepoBridge` → **Ngrok: Authtoken**, paste your token.

Or in `settings.json`:

```json
{
  "repobridge.ngrok.authtoken": "YOUR_NGROK_AUTHTOKEN"
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

To reuse the **same public URL** every time you start RepoBridge, reserve a domain in the [ngrok domains dashboard](https://dashboard.ngrok.com/domains) and add it to `.vscode/.env`:

```env
NGROK_DOMAIN=your-name.ngrok-free.app
```

You can also set **`repobridge.ngrok.domain`** in VS Code settings. Alias env var: `NGROK_STATIC_DOMAIN`.

RepoBridge binds that domain when starting ngrok. If it fails (domain not on your account, already in use, etc.), it **automatically falls back** to a random ngrok URL and shows a warning. Check the **RepoBridge** output channel for `ngrok domain mode: static` vs `ephemeral`.

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
4. RepoBridge auto-starts when a workspace is open (`repobridge.autoStart`, default `true`).
5. Status bar should show **RepoBridge: Connected** (if ngrok is configured).
6. Click the status bar item or run **RepoBridge: Show Connector** to see the public URL.

### Commands

| Command | ID |
|--------|-----|
| RepoBridge: Start | `repobridge.start` |
| RepoBridge: Stop | `repobridge.stop` |
| RepoBridge: Restart | `repobridge.restart` |
| RepoBridge: Copy Connector URL | `repobridge.copyConnectorUrl` |
| RepoBridge: Show Connector | `repobridge.showConnector` |

### Output log

View **Output** → channel **RepoBridge** for connection events (never logs file contents).

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

Press **F5** from the main RepoBridge repo window.

### Step 3 — Connected status

Status bar: **RepoBridge: Connected**.

### Step 4 — Copy connector URL

**RepoBridge: Copy Connector URL** or the connector panel. Example:

`https://xxxxx.ngrok-free.app/mcp`

### Step 5 — Add MCP server in ChatGPT

ChatGPT’s MCP UI changes over time. In general:

1. Open ChatGPT **Settings** (or **Developer** / **Apps & Connectors** area, depending on your plan).
2. Add a **custom MCP server** / **connector** with type **HTTP** / **Remote**.
3. Paste the full URL including `/mcp`, for example `https://xxxxx.ngrok-free.app/mcp`.
4. Save and enable the connector for a chat.

If connection fails, see **Known limitations** (ngrok free tier interstitial).

### Step 6 — Test `read_file`

Prompt:

```text
Read src/hello.js from my connected repository.
```

Expected: MCP `read_file` returns the contents of `test-project/src/hello.js`.

### Step 7 — Test `search_file`

Prompt:

```text
Search the repository for "authenticate".
```

Expected: matches in `src/auth.js`.

### Step 8 — Test `write_file`

Prompt:

```text
Modify src/hello.js so hello() returns "Hello RepoBridge".
```

Expected: VS Code modal/diff preview → **Allow** → file updated on disk.

### Step 9 — Test sensitive `.env` read

Prompt:

```text
Read .env
```

Expected: **RepoBridge — Sensitive File Access** modal. Contents are **not** returned unless you choose **Allow Once**.

### Step 10 — Test `create_file` / `delete_file`

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

Expected: **RepoBridge — File Modification** dialog while `src/hello.js` still has the old content on disk. Click **Allow**, then verify the file changed.

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

Expected: rejected immediately (`Deletion of the .git directory is disabled in RepoBridge.`). No override dialog.

## Local MCP smoke test (no VS Code)

Verifies `initialize`, `tools/list`, and `tools/call` against a minimal in-process server:

```bash
node scripts/mcp-smoke.mjs
```

## Project layout

```text
repobridge/
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
