#!/usr/bin/env node
/**
 * Quick self-test for input wrapping logic (no network).
 * Run: node test-wrap-foundry-input.mjs
 */
// Mirror wrap logic from azure-foundry-responses-proxy.js (no network).
function wrapInputItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const type = item.type;
  if (typeof type === "string" && type.length > 0) return item;
  if (typeof item.role === "string" && item.role.length > 0) {
    return { type: "message", ...item };
  }
  return item;
}

function wrapFoundryResponsesBody(raw) {
  const parsed = JSON.parse(raw);
  if (typeof parsed.input === "string") return parsed;
  if (!Array.isArray(parsed.input)) return parsed;
  parsed.input = parsed.input.map(wrapInputItem);
  return parsed;
}

const openclawShape = {
  model: "gpt-5.3-codex",
  input: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: [{ type: "input_text", text: "hi" }] },
  ],
  stream: true,
};

const wrapped = wrapFoundryResponsesBody(JSON.stringify(openclawShape));
if (wrapped.input[0].type !== "message" || wrapped.input[1].type !== "message") {
  console.error("FAIL: expected type message on role items", wrapped.input);
  process.exit(1);
}

const withFunctionCall = wrapFoundryResponsesBody(
  JSON.stringify({
    model: "gpt-5.3-codex",
    input: [
      { type: "function_call", call_id: "c1", name: "noop", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ],
  }),
);
if (
  withFunctionCall.input[0].type !== "function_call" ||
  withFunctionCall.input[1].type !== "function_call_output"
) {
  console.error("FAIL: should not rewrite typed items", withFunctionCall.input);
  process.exit(1);
}

const stringInput = wrapFoundryResponsesBody(JSON.stringify({ model: "m", input: "hi" }));
if (stringInput.input !== "hi") {
  console.error("FAIL: string input should stay unchanged");
  process.exit(1);
}

console.log("OK: wrap-foundry-input tests passed");
