import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function detectClaudeVersion(): string {
  // Try to read version from installed Claude CLI
  try {
    const version = execSync("claude --version 2>/dev/null", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const match = version.match(/^(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {}
  // Fallback to credentials file
  try {
    const credPath = join(homedir(), ".claude", ".credentials.json");
    const raw = readFileSync(credPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.version && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {}
  return "2.1.81";
}

export const CLIENT_ID =
  process.env.ANTHROPIC_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export const TOKEN_URL =
  process.env.ANTHROPIC_TOKEN_URL ||
  "https://platform.claude.com/v1/oauth/token";

export const AUTHORIZE_URL =
  process.env.ANTHROPIC_AUTHORIZE_URL ||
  "https://claude.ai/oauth/authorize";

// Claude Code uses a local redirect — a local HTTP server catches the callback.
// The redirect_uri includes the dynamic port: http://localhost:{port}/callback
// This constant is only used as a fallback; the real redirect_uri is built at
// runtime with the actual port from startOAuthCallbackServer().
export const REDIRECT_URI =
  process.env.ANTHROPIC_REDIRECT_URI ||
  "http://localhost/callback";

// Manual redirect URL — used when local server can't receive the callback
// (e.g., user copies the code from the browser). This matches Claude CLI's
// MANUAL_REDIRECT_URL from the production OAuth config.
export const MANUAL_REDIRECT_URL =
  process.env.ANTHROPIC_MANUAL_REDIRECT_URL ||
  "https://platform.claude.com/oauth/code/callback";

// Default port for the local OAuth callback server (0 = auto-assign)
export const OAUTH_CALLBACK_PORT = parseInt(
  process.env.ANTHROPIC_OAUTH_CALLBACK_PORT || "0",
  10,
);

// Exact scopes from Claude Code 2.1.81 binary
export const SCOPES =
  process.env.ANTHROPIC_SCOPES ||
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

export const CLI_VERSION =
  process.env.ANTHROPIC_CLI_VERSION || detectClaudeVersion();

export const USER_AGENT =
  process.env.ANTHROPIC_USER_AGENT ||
  `claude-cli/${CLI_VERSION} (external, cli)`;

// Exact beta flags from Claude Code 2.1.81 (confirmed via request interception)
// oauth-2025-04-20 is added separately only for OAuth auth
export const BETA_FLAGS =
  process.env.ANTHROPIC_BETA_FLAGS ||
  "interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219,effort-2025-11-24";

export const OAUTH_BETA_FLAG = "oauth-2025-04-20";

// Exact anthropic-version header from Claude Code SDK
export const ANTHROPIC_VERSION = "2023-06-01";

// Stainless SDK headers (matches what Claude Code's bundled SDK sends)
export const STAINLESS_HEADERS: Record<string, string> = {
  "x-stainless-lang": "js",
  "x-stainless-package-version": process.env.ANTHROPIC_SDK_VERSION || "0.74.0",
  "x-stainless-os": process.platform === "darwin" ? "MacOS" : process.platform === "linux" ? "Linux" : "Windows",
  "x-stainless-arch": process.arch === "arm64" ? "arm64" : process.arch,
  "x-stainless-runtime": "node",
  "x-stainless-runtime-version": process.version,
};

export const TOOL_PREFIX = "mcp_";
