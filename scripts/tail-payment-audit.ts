import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync, chmodSync } from "node:fs";
// Cloudflare tail envelopes may contain request headers. Keep them in memory only;
// persist/print only our explicitly allowlisted audit fields, never raw envelopes.
const output = ".wrangler/v7-payment-audit.ndjson";
writeFileSync(output, "", { mode: 0o600 });
chmodSync(output, 0o600);
const tools = new Set([
  "find_demo_profiles",
  "open_demo_profile",
  "get_my_profile",
  "get_my_invoices",
  "create_payment_link",
  "check_latest_payment",
]);
const events = new Set([
  "mcp_tool_invoked",
  "mcp_tool_completed",
  "mcp_tool_failed",
]);
const statuses = new Set([
  "success",
  "pending",
  "ongoing",
  "processing",
  "abandoned",
  "failed",
  "reversed",
  "not_started",
  "initializing",
  "error",
]);
const child = spawn(
  "node_modules/.bin/wrangler",
  ["tail", "ami-worker", "--format", "json"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let buffer = "";
let count = 0;
function consume(event: any) {
  for (const entry of event.logs ?? [])
    for (const message of entry.message ?? []) {
      if (typeof message !== "string") continue;
      let data: any;
      try {
        data = JSON.parse(message);
      } catch {
        continue;
      }
      if (
        !events.has(data.event) ||
        !tools.has(data.tool) ||
        !/^[-a-f0-9]{36}$/.test(data.invocation_id ?? "")
      )
        continue;
      const safe: Record<string, unknown> = {
        received_at: new Date().toISOString(),
        event: data.event,
        tool: data.tool,
        invocation_id: data.invocation_id,
      };
      if (data.outcome === "success" || data.outcome === "error")
        safe.outcome = data.outcome;
      if (typeof data.code === "string" && /^[A-Z_]{1,64}$/.test(data.code))
        safe.code = data.code;
      if (typeof data.found === "boolean") safe.found = data.found;
      if (statuses.has(data.status)) safe.status = data.status;
      const line = JSON.stringify(safe);
      appendFileSync(output, line + "\n");
      console.log(line);
      count++;
    }
}
function drain() {
  for (;;) {
    const start = buffer.indexOf("{");
    if (start < 0) {
      buffer = "";
      return;
    }
    if (start > 0) buffer = buffer.slice(start);
    let depth = 0,
      quoted = false,
      escaped = false,
      end = -1;
    for (let i = 0; i < buffer.length; i++) {
      const c = buffer[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) return;
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end);
    try {
      consume(JSON.parse(raw));
    } catch {
      /* non-event CLI output is not persisted */
    }
  }
}
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  drain();
});
child.stderr.on("data", () => {
  /* do not forward unfiltered CLI output */
});
const timer = setTimeout(() => child.kill("SIGINT"), 240000);
child.on("error", () => {
  clearTimeout(timer);
  console.error("Unable to start Cloudflare audit tail");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  clearTimeout(timer);
  console.log(`Audit tail finished; ${count} sanitized events saved.`);
  if (code && code !== 130) process.exitCode = code;
});
process.on("SIGINT", () => child.kill("SIGINT"));
console.log(
  "Starting sanitized Cloudflare tool audit tail; request headers are never saved.",
);
