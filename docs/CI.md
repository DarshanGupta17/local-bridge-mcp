# LocalBridge cross-platform CI

GitHub Actions workflow: [`.github/workflows/ci-cross-platform.yml`](../.github/workflows/ci-cross-platform.yml)

## Triggers

- Push and pull request to **`main`** and **`sandbox`**
- Manual **`workflow_dispatch`**

## Matrix

- `ubuntu-latest`
- `macos-latest`
- `windows-latest`

Jobs use **Node.js 22** (required by `@vscode/test-electron` 3.x for VS Code 1.110+ macOS bundles).

Jobs are independent (`fail-fast: false`).

## Secret: ngrok

Add repository Actions secret:

| Secret name | Maps to |
|-------------|---------|
| `NGROK_AUTH_TOKEN` | `NGROK_AUTHTOKEN` at test runtime (see `scripts/ci/env-ngrok.mjs`) |

Fork pull requests do not receive secrets; ngrok integration tests **skip** with exit code 0 and a `SKIP:` log line.

Never commit ngrok tokens. CI does not print token values.

## Local commands

```bash
npm ci
npm run ngrok:platforms
npm run test:ci          # full orchestrator
npm test                 # unit tests only
npm run test:ci:unit     # alias for npm test
```

Optional ngrok tunnel test locally:

```bash
# PowerShell
$env:NGROK_AUTH_TOKEN = "your-token"
npm run test:ci:tunnel:ngrok
```

## Test categories

| # | Script / step | What it verifies |
|---|----------------|------------------|
| 1 | `test-build-vsix.mjs`, optional `vscode-extension.test.mjs` | Compile, VSIX package, core files; extension loads in VS Code test host on CI |
| 2a | `test-tunnel-ngrok.mjs` | Production `startNgrokTunnel`, HTTPS reachability, clean stop |
| 2b | `test-tunnel-cloudflare.mjs` | `cloudflared` via npm package; waits for connector readiness + retries HTTPS probe (trycloudflare edge lag) |
| 3–5, 7 | `ci.integration.test.ts` | Real `WorkspaceFilesystem`, search, shell, `ProcessManager`, security helpers |
| 6 | `mcp-http.integration.test.ts` | MCP Streamable HTTP, auth rejection, `tools/list`, `read_file` |

## Limitations

- Full sidebar/webview UI and permission modals are not automated (require VS Code UI).
- Claude/ChatGPT browser connectors are not exercised; MCP protocol is tested directly.
- Cloudflare/ngrok may skip on network-restricted runners (logged as SKIP, not PASS for failures).
