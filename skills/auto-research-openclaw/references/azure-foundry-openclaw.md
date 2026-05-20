# Azure AI Foundry + OpenClaw (gpt-5.3-codex)

Use this when OpenClaw talks to **Azure AI Foundry** project endpoints (`*.services.ai.azure.com/.../openai/v1`) with **`gpt-5.3-codex`** (or other Responses-only Codex deployments).

## Problem

| Transport | Foundry behavior |
|-----------|------------------|
| Responses `"input": "hi"` (string) | Works |
| Responses `input[]` with `{ "role": "user", "content": ... }` only | **400** `Invalid value: ''` on `input[n]` |
| Chat Completions `/v1/chat/completions` | **Unsupported** for Codex on many deployments |

OpenClaw `openai-responses` builds role-only `input[]` items. Foundry requires `type: "message"` on each message-shaped item.

## Fix: local input-wrapping proxy

Script: `{skill}/scripts/azure-foundry-responses-proxy.js`

It forwards to your real Foundry v1 base URL and wraps any `input[]` element that has `role` but no `type` as:

```json
{ "type": "message", "role": "...", "content": ... }
```

Items that already have a non-empty `type` (`function_call`, `reasoning`, etc.) are unchanged. String `input` is unchanged.

### 1. Start the proxy

```bash
cd "$(git rev-parse --show-toplevel)/skills/auto-research-openclaw/scripts"

export AZURE_FOUNDRY_TARGET_BASE_URL='https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1'
# Optional: AZURE_FOUNDRY_PROXY_PORT=2929  AZURE_FOUNDRY_PROXY_BIND=127.0.0.1

node azure-foundry-responses-proxy.js
```

Copy `azure-foundry-proxy.env.example` to a local env file if you prefer; do not commit keys.

### 2. Point OpenClaw at the proxy

In `~/.openclaw/openclaw.json`:

```json
"azure_openai_response": {
  "baseUrl": "http://127.0.0.1:2929",
  "api": "openai-responses",
  "authHeader": false,
  "apiKey": "YOUR_FOUNDRY_KEY",
  "headers": {
    "api-key": "YOUR_FOUNDRY_KEY"
  },
  "models": [
    {
      "id": "gpt-5.3-codex",
      "name": "gpt-5.3-codex",
      "api": "openai-responses",
      "reasoning": false,
      "input": ["text"],
      "contextWindow": 128000,
      "maxTokens": 4096,
      "compat": {
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "maxTokensField": "max_completion_tokens"
      }
    }
  ]
}
```

Use **`openai-responses`**, not `azure-openai-responses` (the latter adds `api-version`, which `/v1` rejects).

Set agent model when testing:

```text
/model azure_openai_response/gpt-5.3-codex
```

### 3. Verify

```bash
# Proxy + Foundry (via proxy) — after proxy is running
openclaw agent --local --agent main --session-id "$(uuidgen)" \
  --model azure_openai_response/gpt-5.3-codex --message "hi"
```

Self-test wrapping logic (no network):

```bash
node test-wrap-foundry-input.mjs
```

Direct Foundry checks (no OpenClaw):

```bash
# A — string input (baseline)
curl -sS -X POST "$AZURE_FOUNDRY_TARGET_BASE_URL/responses" \
  -H 'Content-Type: application/json' -H "api-key: $KEY" \
  -d '{"model":"gpt-5.3-codex","input":"hi","max_output_tokens":16,"stream":false}'

# B — fails without proxy (OpenClaw shape)
# C — works (typed messages); proxy makes OpenClaw equivalent to C
```

## Session hygiene

After using Ollama on `session:agent:main:main`, run `/new` before switching to Codex so old `thinking` blocks are not replayed into Responses `input[]`.

## Alternative models

- **`gpt-5.3-chat`** on a deployment URL may work with `openai-completions` and a different proxy pattern (see `Dev/openclaw/README-AZURE.md`).
- **Codex on project `/openai/v1`** stays Responses-only; keep this proxy.

## Do not use

| Setting | Why |
|---------|-----|
| `api: "azure-openai-responses"` on `/openai/v1` | Adds forbidden `api-version` query param |
| `api: "openai-completions"` on Codex v1 project URL | Operation unsupported on Codex |
| Direct Foundry `baseUrl` without proxy | OpenClaw role-only `input[]` → 400 |
