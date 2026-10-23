import { Hono } from "hono";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  execute,
  schemas,
  hash,
  DomainError,
  type Env,
  type ToolName,
} from "./domain";
const app = new Hono<{ Bindings: Env }>();
app.get("/health", (c) => c.json({ ok: true, service: "ami-worker" }));
app.use("*", async (c, next) => {
  if (!c.env.API_KEY)
    return c.json({ error: "Service key is not configured" }, 503);
  const supplied = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  if ((await hash(supplied)) !== (await hash(c.env.API_KEY)))
    return c.json({ error: "Unauthorized" }, 401);
  await next();
});
app.onError((err, c) => {
  if (err instanceof z.ZodError)
    return c.json(
      {
        error: "Invalid input",
        issues: err.issues.map((x) => ({ path: x.path, message: x.message })),
      },
      400,
    );
  if (err instanceof DomainError)
    return c.json({ error: err.message }, err.status as 400);
  if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
  console.error("Unhandled request error", err.name);
  return c.json({ error: "Internal server error" }, 500);
});
const routes: Record<string, ToolName> = {
  "/v1/residents/verify": "resolve_resident",
  "/v1/residents/context": "get_resident_context",
  "/v1/maintenance": "create_maintenance_ticket",
  "/v1/maintenance/status": "get_maintenance_status",
  "/v1/complaints": "create_complaint",
  "/v1/rent/summary": "get_rent_summary",
  "/v1/requests": "get_resident_requests",
};
for (const [path, name] of Object.entries(routes))
  app.post(path, async (c) =>
    c.json(await execute(c.env, name, await c.req.json())),
  );
app.all("/mcp", async (c) => {
  const server = new McpServer({
    name: "ami-tenant-concierge",
    version: "0.1.0",
  });
  for (const name of Object.keys(schemas) as ToolName[])
    server.registerTool(
      name,
      {
        description:
          name === "resolve_resident"
            ? "Verify fictional tenant credentials and return a scoped bearer capability. Keep the token private."
            : name.replaceAll("_", " ") + " for the verified resident only.",
        inputSchema: schemas[name].shape,
      },
      async (args: Record<string, unknown>) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await execute(c.env, name, args)),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  err instanceof DomainError
                    ? err.message
                    : err instanceof z.ZodError
                      ? "Invalid tool arguments"
                      : "Unable to complete operation",
              },
            ],
          };
        }
      },
    );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close();
  }
});
export default app;
