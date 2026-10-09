export type CommandRisk = "safe" | "approval" | "block";

export interface CommandClassification {
  risk: CommandRisk;
  reason?: string;
}

const BLOCK_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /169\.254\.169\.254|metadata\.google\.internal/i,
    reason: "Cloud metadata endpoints are not allowed.",
  },
  {
    pattern: /\b(printenv|^\s*env\s*$|\bset\s*$|Get-ChildItem\s+Env:|gci\s+env:)/im,
    reason: "Dumping environment variables is not allowed.",
  },
  {
    pattern: /\$env:[A-Za-z_]/,
    reason: "Reading environment variables via PowerShell is not allowed.",
  },
  {
    pattern: /\b(type|cat|Get-Content|gc)\s+[^\s|&;]*\.env/i,
    reason: "Reading .env files via shell is not allowed. Use read_file with user approval.",
  },
  {
    pattern: /\brm\s+-rf\s+\/|\bformat\s+[a-z]:|\bdiskpart\b/i,
    reason: "Destructive system-wide commands are blocked.",
  },
  {
    pattern: /\blocalbridge\b.*\b(auth|token|secret)/i,
    reason: "Attempting to extract LocalBridge credentials is blocked.",
  },
];

const SAFE_PATTERNS: RegExp[] = [
  /^\s*git\s+status\b/i,
  /^\s*git\s+diff\b/i,
  /^\s*git\s+branch\b/i,
  /^\s*git\s+log\b/i,
  /^\s*git\s+show\b/i,
  /^\s*npm\s+test\b/i,
  /^\s*npm\s+run\s+(test|build|lint|typecheck|check)\b/i,
  /^\s*pnpm\s+(test|run\s+(test|build|lint))\b/i,
  /^\s*yarn\s+(test|run\s+(test|build|lint))\b/i,
  /^\s*bun\s+(test|run\s+(test|build|lint))\b/i,
  /^\s*pytest\b/i,
  /^\s*python\s+-m\s+pytest\b/i,
  /^\s*python\s+-m\s+unittest\b/i,
  /^\s*go\s+test\b/i,
  /^\s*cargo\s+test\b/i,
  /^\s*node\s+--version\b/i,
  /^\s*npm\s+--version\b/i,
];

const APPROVAL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update)\b/i, reason: "Package install/modify" },
  { pattern: /\bpip\s+install\b/i, reason: "Python package install" },
  { pattern: /\bpoetry\s+add\b/i, reason: "Poetry dependency change" },
  { pattern: /\bdocker\s+/i, reason: "Docker command" },
  { pattern: /\bgit\s+(push|commit|reset|clean|rebase|merge|pull)\b/i, reason: "Git write/network operation" },
  { pattern: /\bgit\s+checkout\s+-f\b/i, reason: "Destructive git checkout" },
  { pattern: /\brm\s+-rf\b/i, reason: "Recursive delete" },
  { pattern: /\bdel\s+\/s\b/i, reason: "Recursive delete" },
  { pattern: /\bRemove-Item\s+-Recurse\b/i, reason: "Recursive delete" },
  { pattern: /\bmigrate\b|\bmigration\b/i, reason: "Database migration" },
];

export function classifyCommand(command: string): CommandClassification {
  const trimmed = command.trim();
  if (!trimmed) {
    return { risk: "block", reason: "Empty command." };
  }

  for (const { pattern, reason } of BLOCK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { risk: "block", reason };
    }
  }

  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { risk: "safe" };
    }
  }

  for (const { pattern, reason } of APPROVAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { risk: "approval", reason };
    }
  }

  return { risk: "approval", reason: "Command requires user approval." };
}
