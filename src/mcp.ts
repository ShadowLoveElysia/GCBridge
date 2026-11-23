import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { controlSchema } from "./control.ts";
import { publicError } from "./errors.ts";
import type { Manager } from "./manager.ts";
import { toolDescription } from "./protocol.ts";
import { toolResult } from "./tool-result.ts";

export async function startMcp(manager: Manager): Promise<McpServer> {
  const server = new McpServer(
    { name: "gc-bridge", version: "0.3.0" },
    {
      instructions:
        "GC Bridge is disabled by default. Only explicit user start may launch the headless OMP director. Connecting MCP must not start it. list/read lets the user select history; delete_preview must be followed by user confirmation before delete. Any configured model may collaborate. Keep full replies in tool results. Final plans must report collaborator-raised issues, new perspectives, adopted/adjusted/deferred suggestions with rationale. No automatic repository reads or paid inference merely on start.",
    },
  );
  server.registerTool(
    "gc_bridge",
    {
      title: "GC Bridge: creative direction",
      description: toolDescription,
      inputSchema: controlSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      try {
        const result = await manager.dispatch(args, extra.signal);
        return toolResult(result);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(publicError(error)) }],
        };
      }
    },
  );
  await server.connect(new StdioServerTransport());
  return server;
}
