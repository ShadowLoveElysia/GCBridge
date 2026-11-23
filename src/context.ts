import type { Message } from "@oh-my-pi/pi-ai";
import { BridgeError } from "./errors.ts";
import type { Session } from "./store.ts";

export interface ContextSelection {
  turnIds?: string[];
  contextItemIds?: string[];
}
export function selectedHistory(session: Session, selection: ContextSelection): Message[] {
  if (selection.turnIds === undefined) return session.messages;
  const ids = new Set(selection.turnIds);
  if (
    ids.size !== selection.turnIds.length ||
    [...ids].some((id) => !session.turns.some((t) => t.requestId === id))
  )
    throw new BridgeError("INVALID_SELECTION", "Selected rounds do not belong to this discussion.");
  return session.turns.flatMap((t, i) =>
    ids.has(t.requestId) ? session.messages.slice(i * 2, i * 2 + 2) : [],
  );
}
export function selectedMaterials(
  session: Session,
  selection: ContextSelection,
  context?: string,
): string | undefined {
  const ids = new Set(selection.contextItemIds ?? []),
    items = session.workspaceData?.contextItems ?? [];
  if (
    ids.size !== (selection.contextItemIds ?? []).length ||
    [...ids].some((id) => !items.some((item) => item.id === id))
  )
    throw new BridgeError(
      "INVALID_SELECTION",
      "Selected materials do not belong to this discussion.",
    );
  const parts = [
    context ?? "",
    ...items
      .filter((item) => ids.has(item.id))
      .map((item) => JSON.stringify({ title: item.title, text: item.text })),
  ].filter(Boolean);
  const text = parts.join("\n\n");
  if (text.length > 1_000_000)
    throw new BridgeError("CONTEXT_LIMIT", "Selected materials exceed the input limit.");
  return text || undefined;
}
