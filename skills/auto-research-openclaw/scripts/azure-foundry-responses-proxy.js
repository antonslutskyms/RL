#!/usr/bin/env node
/**
 * Azure AI Foundry Responses API proxy for OpenClaw.
 *
 * Foundry requires each element of `input[]` to include `type` (e.g. "message").
 * OpenClaw's openai-responses transport sends { role, content } without `type`,
 * which Azure rejects: Invalid value: '' (param input[n]).
 *
 * This proxy wraps role-only items as { type: "message", ...item } before forwarding.
 * String shorthand input ("hi") and items that already have a non-empty type are unchanged.
 *
 * Usage:
 *   export AZURE_FOUNDRY_TARGET_BASE_URL='https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1'
 *   node azure-foundry-responses-proxy.js
 *
 * OpenClaw models.providers (example):
 *   "baseUrl": "http://127.0.0.1:2929",
 *   "api": "openai-responses",
 *   "authHeader": false,
 *   "headers": { "api-key": "<foundry-key>" }
 *
 * See ../references/azure-foundry-openclaw.md
 */
const http = require("http");
const https = require("https");

const TARGET_BASE = process.env.AZURE_FOUNDRY_TARGET_BASE_URL?.replace(/\/+$/, "");
const PORT = Number(process.env.AZURE_FOUNDRY_PROXY_PORT || 2929);
const BIND = process.env.AZURE_FOUNDRY_PROXY_BIND || "127.0.0.1";

const FORWARD_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "content-type",
  "accept",
  "user-agent",
  "openai-beta",
]);

if (!TARGET_BASE) {
  console.error(
    "AZURE_FOUNDRY_TARGET_BASE_URL is required (no trailing slash), e.g.\n" +
      "  https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1",
  );
  process.exit(1);
}

/**
 * @param {unknown} item
 * @returns {unknown}
 */
function wrapInputItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }
  const record = /** @type {Record<string, unknown>} */ (item);
  const type = record.type;
  if (typeof type === "string" && type.length > 0) {
    return item;
  }
  const role = record.role;
  if (typeof role === "string" && role.length > 0) {
    return { type: "message", ...record };
  }
  return item;
}

/**
 * @param {Buffer} rawBody
 * @returns {Buffer}
 */
function wrapFoundryResponsesBody(rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return rawBody;
  }
  if (!parsed || typeof parsed !== "object") {
    return rawBody;
  }
  if (typeof parsed.input === "string") {
    return Buffer.from(JSON.stringify(parsed));
  }
  if (!Array.isArray(parsed.input)) {
    return rawBody;
  }
  parsed.input = parsed.input.map(wrapInputItem);
  return Buffer.from(JSON.stringify(parsed));
}

/**
 * @param {string} reqUrl
 * @returns {string}
 */
function buildTargetUrl(reqUrl) {
  const incoming = new URL(reqUrl || "/", "http://127.0.0.1");
  return `${TARGET_BASE}${incoming.pathname}${incoming.search}`;
}

/**
 * @param {import("http").IncomingHttpHeaders} reqHeaders
 * @returns {Record<string, string>}
 */
function pickForwardHeaders(reqHeaders) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(reqHeaders)) {
    const lower = key.toLowerCase();
    if (!FORWARD_HEADER_NAMES.has(lower) || value === undefined) {
      continue;
    }
    out[key] = Array.isArray(value) ? String(value[0]) : String(value);
  }
  if (!out["content-type"]) {
    out["content-type"] = "application/json";
  }
  return out;
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {Buffer} rawBody
 * @returns {boolean}
 */
function shouldWrapBody(rawBody) {
  if (rawBody.length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    return Boolean(parsed && typeof parsed === "object" && Array.isArray(parsed.input));
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const rawBody = await readBody(req);
    const body = shouldWrapBody(rawBody) ? wrapFoundryResponsesBody(rawBody) : rawBody;

    const target = new URL(buildTargetUrl(req.url));
    const headers = pickForwardHeaders(req.headers);
    const lib = target.protocol === "https:" ? https : http;

    const proxyReq = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: {
          ...headers,
          host: target.host,
          ...(body.length > 0 ? { "content-length": String(body.length) } : {}),
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: { message: err.message } }));
    });

    if (body.length > 0) {
      proxyReq.end(body);
    } else {
      proxyReq.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: { message } }));
  }
});

server.listen(PORT, BIND, () => {
  console.log(`Azure Foundry Responses proxy listening on http://${BIND}:${PORT}`);
  console.log(`Forwarding to ${TARGET_BASE}`);
  console.log("Wraps input[] items that have role but no type as type: message");
});
