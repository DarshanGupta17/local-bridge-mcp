/**
 * Maps MCP initialize `clientInfo.name` to a friendly label for permission dialogs.
 */
export function formatMcpClientDisplayName(rawName?: string | null): string {
  if (!rawName?.trim()) {
    return "An AI assistant";
  }

  const name = rawName.trim();
  const lower = name.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/chatgpt|openai|gpt/i, "ChatGPT"],
    [/claude|anthropic/i, "Claude"],
    [/gemini|google-ai|google ai/i, "Gemini"],
    [/copilot|github-copilot/i, "GitHub Copilot"],
    [/cursor/i, "Cursor"],
    [/cody|sourcegraph/i, "Cody"],
    [/perplexity/i, "Perplexity"],
    [/mistral/i, "Mistral"],
    [/groq/i, "Groq"],
    [/deepseek/i, "DeepSeek"],
    [/ollama/i, "Ollama"],
    [/lm studio|lmstudio/i, "LM Studio"],
    [/continue/i, "Continue"],
    [/windsurf|codeium/i, "Windsurf"],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(lower) || pattern.test(name)) {
      return label;
    }
  }

  return name;
}
