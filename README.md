# opencode-claude-bridge

Use your Claude Pro/Max subscription in [OpenCode](https://opencode.ai). If you're logged into the Claude CLI, it just works — no extra setup.

## Install

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-claude-bridge"]
}
```

OpenCode auto-installs the plugin from npm on next launch.

If you're logged into the Claude CLI (`claude login`), the plugin auto-syncs your credentials — just select an Anthropic model and start chatting. If not, you'll be prompted to authenticate via browser OAuth or enter an API key.

**Upgrade:**

OpenCode pins the installed version. To upgrade to the latest:

```bash
cd ~/.cache/opencode && npm install opencode-claude-bridge@latest
```

Then restart OpenCode.

<details>
<summary>Install from source</summary>

```bash
git clone https://github.com/dotCipher/opencode-claude-bridge.git ~/opencode-claude-bridge
cd ~/opencode-claude-bridge && npm install && npm run build
```

Then reference the full path in your config:

```json
{
  "plugin": ["/Users/YOU/opencode-claude-bridge/dist/index.js"]
}
```
</details>

## How the bridge works

The plugin sits between OpenCode and the Anthropic API:

> **OpenCode** → **opencode-claude-bridge** → **Anthropic API**

**Authentication** — Supports both OAuth and API key auth:

- **OAuth (Pro/Max)** — Auto-reads your Claude CLI's OAuth tokens from macOS Keychain (or `~/.claude/.credentials.json` on Linux). No browser flow needed. If Claude CLI isn't available, falls back to browser-based OAuth PKCE.
- **API key** — Works alongside a standard `provider` entry in your OpenCode config with an `apiKey`. The plugin only activates its OAuth handling for the built-in `anthropic` provider; custom API key providers pass through unchanged.

**Token refresh** — When tokens expire, three layers are tried: re-read from Keychain, refresh via stored token, refresh via CLI's token.

**Request transformation** — Every outbound OAuth request is rewritten to match what Claude Code sends as closely as possible: current headers, `?beta=true` URL parameter, `thinking`, `context_management`, `output_config`, session metadata, `mcp_` tool name prefixing, and system prompt sanitization.

## Requirements

- [OpenCode](https://opencode.ai) v1.2+
- For OAuth: [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude login`)
- macOS (Keychain) or Linux (`~/.claude/.credentials.json` fallback)
- For API key: just configure a `provider` with `apiKey` in your OpenCode config as usual

## Environment overrides

All OAuth and header parameters can be overridden via environment variables (`ANTHROPIC_CLIENT_ID`, `ANTHROPIC_TOKEN_URL`, `ANTHROPIC_AUTHORIZE_URL`, `ANTHROPIC_CLI_VERSION`, `ANTHROPIC_CLI_BUILD_ID`, `ANTHROPIC_ENTRYPOINT`, `ANTHROPIC_SDK_VERSION`, `ANTHROPIC_BETA_FLAGS`, `ANTHROPIC_BILLING_CCH`, `ANTHROPIC_SYSTEM_PROMPT_PATH`). Defaults match Claude Code 2.1.98 — most users won't need to change these.

## Updating for new Claude CLI versions

When Claude Code updates, the required headers or body fields may change. To capture exactly what the latest Claude CLI sends:

```bash
./scripts/intercept-claude.sh claude-sonnet-4-6
```

This starts a local proxy, runs Claude CLI through it with OAuth, and saves the full request headers and body to `/tmp/claude-intercept-*`. Compare against the plugin's constants and fetch wrapper to spot differences.

Key things that have changed across versions:
- `anthropic-beta` flags (required set changes)
- Body fields (`thinking`, `metadata`, `context_management`)
- `user-agent` version string
- `x-stainless-package-version`
- `x-claude-code-session-id`
- billing header shape (`cc_version`, `cc_entrypoint`, `cch`)

## Local validation

To validate how local OpenCode traffic is being classified and how closely it matches Claude Code on the wire:

```bash
npm run validate:oauth -- --model claude-sonnet-4-6 --prompt "Reply with exactly VALIDATE."
```

The validator will:

- query the OAuth usage endpoint before and after each run
- capture an official Claude Code request through a local proxy
- capture an OpenCode request using this repo's local `dist/index.js`
- write Claude Code's captured system prompt to `~/.cache/opencode-claude-bridge/claude-system-prompt.json`
- save request and response artifacts under `tmp/validate-*`
- write a `report.json` with request diffs, body hashes, and usage snapshots

After the first successful validator run, the bridge will automatically reuse that cached Claude Code system prompt. This is currently the key step that makes OpenCode traffic behave like standard Claude Code usage on this machine.

If OpenCode is being treated as an OAuth app / extra-usage flow, the report will usually show it in one of two ways:

- the OpenCode run fails with an extra-usage style API error
- the usage buckets diverge from the Claude Code run even when the headers look similar

## Important limitation

Anthropic's own Claude Code docs say third-party integrations should use API key authentication. This bridge can make OAuth requests look much closer to current Claude Code traffic, but Anthropic may still apply server-side classification that a bridge cannot fully control.

## Credits

Combines approaches from [shahidshabbir-se/opencode-anthropic-oauth](https://github.com/shahidshabbir-se/opencode-anthropic-oauth), [ex-machina-co/opencode-anthropic-auth](https://github.com/ex-machina-co/opencode-anthropic-auth), [vinzabe/PERMANENT-opencode-anthropic-oauth-fix](https://github.com/vinzabe/PERMANENT-opencode-anthropic-oauth-fix), and [lehdqlsl/opencode-claude-auth-sync](https://github.com/lehdqlsl/opencode-claude-auth-sync).

## License

MIT
