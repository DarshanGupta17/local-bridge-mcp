import {
  MCP_TOOL_DEFINITIONS,
  type ToolPermissionLevel,
} from "../security/toolPermissions.js";

export function renderPermissionsScreenBody(
  levels: Record<string, ToolPermissionLevel>
): string {
  const byCategory = groupByCategory(MCP_TOOL_DEFINITIONS);
  const rows = byCategory
    .map(
      ([category, tools]) => `
        <section class="perm-category">
          <h2 class="perm-category-title">${escapeHtml(category)}</h2>
          ${tools.map((tool) => renderToolRow(tool, levels[tool.name] ?? "needs_approval")).join("")}
        </section>`
    )
    .join("");

  return `
    <div class="perm-screen">
      <div class="perm-header-row">
        <button type="button" class="secondary perm-back" onclick="post('goToStep', { step: 'running' })">← Back</button>
      </div>
      <h1 class="perm-title">Configure Permissions</h1>
      <p class="perm-subtitle">Select what AI can access</p>
      <p class="perm-lead">Applies to MCP clients (ChatGPT, Claude, Gemini, etc.) using LocalBridge. <strong>Always Allow</strong> skips LocalBridge approval dialogs for that tool. Hard command blocks still apply.</p>
      <div class="perm-toolbar">
        <button type="button" class="secondary" onclick="post('resetAllPermissions')">Reset all to Needs Approval</button>
      </div>
      <div class="perm-list">${rows}</div>
    </div>`;
}

function renderToolRow(
  tool: (typeof MCP_TOOL_DEFINITIONS)[number],
  level: ToolPermissionLevel
): string {
  const levels: ToolPermissionLevel[] = ["always_allow", "needs_approval", "blocked"];
  const labels: Record<ToolPermissionLevel, string> = {
    always_allow: "Always Allow",
    needs_approval: "Needs Approval",
    blocked: "Blocked",
  };
  const safeName = tool.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `
    <article class="perm-tool">
      <div class="perm-tool-head">
        <span class="perm-tool-name">${escapeHtml(tool.title)}</span>
        <span class="perm-tool-id">${escapeHtml(tool.name)}</span>
        <p class="perm-tool-desc">${escapeHtml(tool.description)}</p>
      </div>
      <div class="perm-levels" role="radiogroup" aria-label="${escapeHtml(tool.title)}">
        ${levels
          .map(
            (l) =>
              `<button type="button" class="perm-level-btn${l === level ? " active" : ""}" aria-pressed="${l === level}" onclick="setPermissionLevel('${safeName}','${l}')">${labels[l]}</button>`
          )
          .join("")}
      </div>
    </article>`;
}

function groupByCategory(
  tools: typeof MCP_TOOL_DEFINITIONS
): [string, typeof MCP_TOOL_DEFINITIONS][] {
  const order = ["Workspace", "Git", "Execution", "Context"];
  const map = new Map<string, typeof MCP_TOOL_DEFINITIONS>();
  for (const t of tools) {
    const list = map.get(t.category) ?? [];
    list.push(t);
    map.set(t.category, list);
  }
  return order.filter((c) => map.has(c)).map((c) => [c, map.get(c)!]);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
