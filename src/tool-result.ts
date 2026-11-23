/** Preserve full collaborator text in native MCP tool output, outside chat commentary. */
export function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(value && typeof value === "object"
      ? { structuredContent: value as Record<string, unknown> }
      : {}),
  };
}
