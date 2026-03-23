import {
  createAuthorizationRequest,
  exchangeCodeForTokens,
  parseAuthCode,
  refreshTokens,
} from "./oauth.js";
import { getClaudeTokens, readClaudeCredentials } from "./keychain.js";
import {
  BETA_FLAGS,
  OAUTH_BETA_FLAG,
  ANTHROPIC_VERSION,
  STAINLESS_HEADERS,
  TOOL_PREFIX,
  USER_AGENT,
} from "./constants.js";

type AuthType = {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
};

type ProviderModel = {
  cost: unknown;
};

type PluginClient = {
  auth: {
    set: (args: {
      path: { id: string };
      body: Record<string, unknown>;
    }) => Promise<void>;
  };
};

const AnthropicOAuthCombined = async ({ client }: { client: PluginClient }) => {
  // Track current OAuth state for header injection
  let currentAuth: AuthType = { type: "none" };

  return {
    // --- System prompt: prepend Claude Code identity ---
    "experimental.chat.system.transform": (
      input: { model?: { providerID: string } },
      output: { system: string[] },
    ) => {
      if (input.model?.providerID === "anthropic") {
        const prefix =
          "You are Claude Code, Anthropic's official CLI for Claude.";
        if (output.system.length > 0) {
          output.system[0] = output.system[0]
            .replace(/OpenCode/g, "Claude Code")
            .replace(/opencode/gi, "Claude");
          output.system[0] = `${prefix}\n\n${output.system[0]}`;
        } else {
          output.system.push(prefix);
        }
      }
    },

    // --- Header injection: exact Claude Code 2.1.81 headers ---
    "chat.headers": async (
      input: { model?: { providerID: string } },
      output: { headers: Record<string, string> },
    ) => {
      if (input.model?.providerID !== "anthropic") return;
      if (currentAuth.type !== "oauth") return;

      // Layered token refresh if expired
      if (
        !currentAuth.access ||
        !currentAuth.expires ||
        currentAuth.expires < Date.now()
      ) {
        let fresh: {
          access: string;
          refresh: string;
          expires: number;
        } | null = null;

        // Layer 1: Claude CLI keychain
        try {
          const keychainTokens = getClaudeTokens();
          if (keychainTokens && keychainTokens.expires > Date.now() + 60_000) {
            fresh = keychainTokens;
          }
        } catch {}

        // Layer 2: Stored refresh token
        if (!fresh && currentAuth.refresh) {
          try {
            fresh = refreshTokens(currentAuth.refresh);
          } catch {}
        }

        // Layer 3: CLI refresh token
        if (!fresh) {
          try {
            const creds = readClaudeCredentials();
            if (creds?.claudeAiOauth?.refreshToken) {
              fresh = refreshTokens(creds.claudeAiOauth.refreshToken);
            }
          } catch {}
        }

        if (fresh) {
          await client.auth.set({
            path: { id: "anthropic" },
            body: {
              type: "oauth",
              refresh: fresh.refresh,
              access: fresh.access,
              expires: fresh.expires,
            },
          });
          currentAuth.access = fresh.access;
          currentAuth.refresh = fresh.refresh;
          currentAuth.expires = fresh.expires;
        }
      }

      // OAuth auth header
      output.headers["authorization"] = `Bearer ${currentAuth.access}`;
      delete output.headers["x-api-key"];

      // Identity headers
      output.headers["user-agent"] = USER_AGENT;
      output.headers["x-app"] = "cli";
      output.headers["anthropic-dangerous-direct-browser-access"] = "true";

      // Stainless SDK headers
      for (const [k, v] of Object.entries(STAINLESS_HEADERS)) {
        output.headers[k] = v;
      }
      output.headers["x-stainless-retry-count"] =
        output.headers["x-stainless-retry-count"] || "0";
      output.headers["x-stainless-timeout"] =
        output.headers["x-stainless-timeout"] || "600";

      // Beta flags: merge required + oauth + any existing
      const existing = (output.headers["anthropic-beta"] || "")
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean);
      const required = BETA_FLAGS.split(",").map((b) => b.trim());
      output.headers["anthropic-beta"] = [
        ...new Set([...required, OAUTH_BETA_FLAG, ...existing]),
      ].join(",");
    },

    auth: {
      provider: "anthropic",

      async loader(
        getAuth: () => Promise<AuthType>,
        provider: { models: Record<string, ProviderModel> },
      ) {
        let auth = await getAuth();

        // Auto-bootstrap: if no OAuth tokens stored yet, try Claude CLI keychain
        if (auth.type !== "oauth") {
          try {
            const keychainTokens = getClaudeTokens();
            if (keychainTokens) {
              console.error(
                "[opencode-oauth] Auto-synced credentials from Claude CLI",
              );
              await client.auth.set({
                path: { id: "anthropic" },
                body: {
                  type: "oauth",
                  refresh: keychainTokens.refresh,
                  access: keychainTokens.access,
                  expires: keychainTokens.expires,
                },
              });
              auth = {
                type: "oauth",
                access: keychainTokens.access,
                refresh: keychainTokens.refresh,
                expires: keychainTokens.expires,
              };
            }
          } catch {
            // Keychain unavailable
          }
        }

        // Store auth state for chat.headers hook
        currentAuth = auth;

        if (auth.type === "oauth") {
          // Zero out cost for Pro/Max subscription
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: { read: 0, write: 0 },
            };
          }

          return {
            // Pass authToken so SDK uses Bearer auth
            authToken: auth.access,
            // Override URL to add ?beta=true
            buildRequestUrl: (baseURL: string) => `${baseURL}/messages?beta=true`,
            // Pass our custom fetch for body transformation + retry
            async fetch(
              input: string | URL | Request,
              init?: RequestInit,
            ) {
              // Re-read auth for freshness
              const freshAuth = await getAuth();
              if (freshAuth.type === "oauth") {
                currentAuth = freshAuth;
              }

              // --- Transform request body ---
              let body = init?.body;
              if (body && typeof body === "string") {
                try {
                  const parsed = JSON.parse(body);

                  // Prefix tool definitions (avoid double-prefixing)
                  if (parsed.tools && Array.isArray(parsed.tools)) {
                    parsed.tools = parsed.tools.map(
                      (tool: { name?: string }) => ({
                        ...tool,
                        name:
                          tool.name && !tool.name.startsWith(TOOL_PREFIX)
                            ? `${TOOL_PREFIX}${tool.name}`
                            : tool.name,
                      }),
                    );
                  }

                  // Prefix tool_use blocks in messages
                  if (parsed.messages && Array.isArray(parsed.messages)) {
                    parsed.messages = parsed.messages.map(
                      (msg: {
                        content?: Array<{
                          type?: string;
                          name?: string;
                        }>;
                      }) => {
                        if (msg.content && Array.isArray(msg.content)) {
                          msg.content = msg.content.map(
                            (block: { type?: string; name?: string }) => {
                              if (
                                block.type === "tool_use" &&
                                block.name &&
                                !block.name.startsWith(TOOL_PREFIX)
                              ) {
                                return {
                                  ...block,
                                  name: `${TOOL_PREFIX}${block.name}`,
                                };
                              }
                              return block;
                            },
                          );
                        }
                        return msg;
                      },
                    );
                  }

                  body = JSON.stringify(parsed);
                } catch {
                  // ignore parse errors
                }
              }

              const newInit = { ...init, body };
              const response = await fetch(input, newInit);

              // Strip mcp_ prefix from streaming response
              if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const encoder = new TextEncoder();

                const stream = new ReadableStream({
                  async pull(controller) {
                    const { done, value } = await reader.read();
                    if (done) {
                      controller.close();
                      return;
                    }
                    let text = decoder.decode(value, { stream: true });
                    text = text.replace(
                      /"name"\s*:\s*"mcp_([^"]+)"/g,
                      '"name": "$1"',
                    );
                    controller.enqueue(encoder.encode(text));
                  },
                });

                return new Response(stream, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              }

              return response;
            },
          };
        }

        return {};
      },

      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth" as const,
          authorize: async () => {
            // First try: auto-sync from Claude CLI (zero interaction)
            const tokens = getClaudeTokens();
            if (tokens) {
              console.error(
                "[opencode-oauth] Auto-authenticated via Claude CLI",
              );
              return {
                type: "success" as const,
                access: tokens.access,
                refresh: tokens.refresh,
                expires: tokens.expires,
              };
            }

            // Fallback: browser-based OAuth PKCE flow
            console.error(
              "[opencode-oauth] No Claude CLI found, starting browser OAuth...",
            );
            const { url, verifier } = createAuthorizationRequest();
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code" as const,
              callback: async (code: string) => {
                try {
                  const cleanCode = parseAuthCode(code);
                  const exchanged = exchangeCodeForTokens(
                    cleanCode,
                    verifier,
                  );
                  return {
                    type: "success" as const,
                    access: exchanged.access,
                    refresh: exchanged.refresh,
                    expires: exchanged.expires,
                  };
                } catch (err) {
                  console.error(
                    `[opencode-oauth] Token exchange failed: ${err}`,
                  );
                  return { type: "failed" as const };
                }
              },
            };
          },
        },
      ],
    },
  };
};

export default AnthropicOAuthCombined;
