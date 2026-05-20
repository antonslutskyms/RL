#!/usr/bin/env node
/**
 * Azure AI Foundry Responses API proxy for OpenClaw.
 *
 * 1. Wraps input[] items that have `role` but no `type` as { type: "message", ... }.
 * 2. Normalizes target base URL (must end with /openai/v1, not /responses).
 * 3. Dedupes paths when OpenClaw baseUrl incorrectly includes /openai/v1.
 * 4. Strips OpenAI-only request fields Foundry often rejects (store, context_management, …).
 *
 * Usage:
 *   export AZURE_FOUNDRY_TARGET_BASE_URL='https://<resource>.services.ai.azure.com/api/projects/<project>/openai/v1'
 *   node azure-foundry-responses-proxy.js
 *
 * OpenClaw provider baseUrl must be ONLY http://127.0.0.1:2929 (no /openai/v1 suffix).
 *
 * Debug:
 *   AZURE_FOUNDRY_PROXY_VERBOSE=1
 *   AZURE_FOUNDRY_PROXY_STRIP_TOOLS=1   # omit tools[] (test "unsupported operation")
 */
const http = require("http");
const https = require("https");

const VERBOSE = process.env.AZURE_FOUNDRY_PROXY_VERBOSE === "1";
const STRIP_TOOLS = process.env.AZURE_FOUNDRY_PROXY_STRIP_TOOLS === "1";

/**
 * @param {string | undefined} url
 * @returns {string}
 */
function normalizeTargetBase(url) {
  let base = (url || "").replace(/\/+$/, "");
  if (/\/responses$/i.test(base)) {
    console.warn(
      "[foundry-proxy] AZURE_FOUNDRY_TARGET_BASE_URL must end with /openai/v1, not /responses; stripped trailing /responses",
    );
    base = base.replace(/\/responses$/i, "");
  }
  return base;
}

const TARGET_BASE = normalizeTargetBase(process.env.AZURE_FOUNDRY_TARGET_BASE_URL);
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
    "AZURE_FOUNDRY_TARGET_BASE_URL is required (end with /openai/v1, no trailing /responses), e.g.\n" +
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
 * @param {Record<string, unknown>} parsed
 * @returns {Record<string, unknown>}
 */
function sanitizeFoundryResponsesPayload(parsed) {
  delete parsed.store;
  delete parsed.context_management;
  delete parsed.prompt_cache_key;
  delete parsed.prompt_cache_retention;

  if (STRIP_TOOLS) {
    delete parsed.tools;
    delete parsed.tool_choice;
  } else if (Array.isArray(parsed.tools)) {
    parsed.tools = parsed.tools.filter((tool) => {
      if (!tool || typeof tool !== "object") {
        return false;
      }
      const t = /** @type {Record<string, unknown>} */ (tool).type;
      return t === "function" || t === undefined;
    });
  }

  return parsed;
}

/**
 * @param {Buffer} rawBody
 * @returns {Buffer}
 */
function transformResponsesBody(rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return rawBody;
  }
  if (!parsed || typeof parsed !== "object") {
    return rawBody;
  }

  sanitizeFoundryResponsesPayload(/** @type {Record<string, unknown>} */ (parsed));

  if (typeof parsed.input === "string") {
    return Buffer.from(JSON.stringify(parsed));
  }
  if (!Array.isArray(parsed.input)) {
    return Buffer.from(JSON.stringify(parsed));
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
  let path = incoming.pathname || "/";

  const baseSuffix = "/openai/v1";
  if (TARGET_BASE.endsWith(baseSuffix) && path.startsWith(baseSuffix)) {
    path = path.slice(baseSuffix.length) || "/";
  }

  return `${TARGET_BASE}${path}${incoming.search}`;
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
function shouldTransformBody(rawBody) {
  if (rawBody.length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    return Boolean(parsed && typeof parsed === "object");
  } catch {
    return false;
  }
}

/**
 * @param {import("http").IncomingMessage} proxyRes
 * @returns {Promise<Buffer>}
 */
async function readResponseBody(proxyRes) {
  const chunks = [];
  for await (const chunk of proxyRes) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const rawBody = await readBody(req);
    const forwardPath = buildTargetUrl(req.url);
    const target = new URL(forwardPath);
    const transformBody =
      req.method === "POST" && target.pathname.endsWith("/responses");
    const body = transformBody && shouldTransformBody(rawBody)
      ? transformResponsesBody(rawBody)
      : rawBody;

    if (VERBOSE) {
      console.log(
        `[foundry-proxy] ${req.method} ${req.url || "/"} -> ${forwardPath}` +
          (transformBody ? " (transform body)" : "") +
          (STRIP_TOOLS ? " strip_tools=1" : ""),
      );
    }

    if (forwardPath.includes("/chat/completions")) {
      console.warn(
        "[foundry-proxy] Warning: request targets /chat/completions; gpt-5.3-codex on Foundry is usually Responses-only",
      );
    }

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
      async (proxyRes) => {
        const status = proxyRes.statusCode ?? 502;
        if (VERBOSE && status >= 400) {
          const errBody = await readResponseBody(proxyRes);
          console.error(
            `[foundry-proxy] upstream ${status} ${forwardPath}: ${errBody.toString("utf8").slice(0, 500)}`,
          );
          res.writeHead(status, proxyRes.headers);
          res.end(errBody);
          return;
        }
        if (VERBOSE) {
          console.log(`[foundry-proxy] upstream ${status} ${forwardPath}`);
        }
        res.writeHead(status, proxyRes.headers);
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
  console.log(`Target base: ${TARGET_BASE}`);
  console.log("Expect OpenClaw baseUrl: http://127.0.0.1:" + PORT + " (no /openai/v1 suffix)");
  console.log("Transforms POST .../responses JSON: wrap input[] + strip store/context_management");
  if (STRIP_TOOLS) {
    console.log("AZURE_FOUNDRY_PROXY_STRIP_TOOLS=1: omitting tools[] from requests");
  }
});
