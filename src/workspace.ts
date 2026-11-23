import { createHash, randomUUID } from "node:crypto";
import { sessionFingerprint } from "./bridge.ts";
import type { Config } from "./config.ts";
import type { ControlRequest } from "./control.ts";
import { BridgeError } from "./errors.ts";
import type { Session, Store } from "./store.ts";
import type { WorkspaceData } from "./workspace-types.ts";

export const workspaceOperations = new Set([
  "branch",
  "workspace",
  "opinion_save",
  "context_save",
  "snapshot",
  "snapshot_read",
]);
export function workspaceData(session: Session): WorkspaceData {
  return session.workspaceData ?? { opinions: [], contextItems: [], snapshots: [] };
}
export const revision = (session: Session) =>
  createHash("sha256").update(JSON.stringify(session)).digest("hex");
export function sessionMarkdown(session: Session): string {
  const data = workspaceData(session);
  return [
    `# ${session.title}`,
    `Session: ${session.id}`,
    data.parent ? `Branch of ${data.parent.title} through round ${data.parent.throughTurn}` : "",
    ...session.turns.map(
      (t, i) =>
        `## ${i + 1}. ${t.mode} · ${t.collaborator?.model ?? "Collaborator"}\n\nRequest: ${t.requestId}\n\n${t.prompt}\n\n${t.text}`,
    ),
    "## Viewpoints, agreements and open issues",
    ...data.opinions.map(
      (o) =>
        `- [${o.kind} / ${o.status}] ${o.text}\n  Author: ${o.author}; source: ${o.sourceRequestId ?? "user annotation"}\n  Rationale: ${o.rationale}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}
export function workspaceDispatch(store: Store, config: Config, request: ControlRequest): unknown {
  if (!request.sessionId) throw new BridgeError("SESSION_REQUIRED", "Select a discussion first.");
  return store.transaction(() => {
    const session = store.get(request.sessionId as string),
      data = structuredClone(workspaceData(session));
    if (request.operation === "workspace")
      return { sessionId: session.id, title: session.title, ...data, revision: revision(session) };
    if (request.operation === "snapshot_read") {
      const snapshot = data.snapshots.find((s) => s.id === request.snapshotId);
      if (!snapshot) throw new BridgeError("SNAPSHOT_NOT_FOUND", "Select an existing snapshot.");
      return { sessionId: session.id, snapshot };
    }
    if (session.status === "pending")
      throw new BridgeError(
        "SESSION_BUSY",
        "Wait for the active discussion before changing workspace records.",
      );
    const now = new Date().toISOString();
    if (request.operation === "branch") {
      const through = request.throughTurn ?? session.turns.length;
      if (through > session.turns.length)
        throw new BridgeError("INVALID_ROUND", "Branch boundary exceeds saved history.");
      const id = randomUUID();
      const targetProfile = request.profileId ?? data.profileId;
      const chosenConfig = profileConfig(config, targetProfile);
      const profileChanged = targetProfile !== data.profileId;
      const turns = structuredClone(session.turns.slice(0, through));
      const opinionIds = new Set(turns.map((t) => t.requestId));
      const branch: Session = {
        id,
        title: request.title ?? `${session.title.slice(0, 90)} · branch`,
        fingerprint: profileChanged ? sessionFingerprint(chosenConfig) : session.fingerprint,
        status: "ready",
        messages: structuredClone(session.messages.slice(0, through * 2)),
        turns,
        totalTokens: turns.reduce((n, t) => n + t.usage.totalTokens, 0),
        leaseUntil: 0,
        createdAt: now,
        updatedAt: now,
        workspaceData: {
          parent: { sessionId: session.id, throughTurn: through, title: session.title },
          profileId: request.profileId ?? data.profileId,
          inheritedTokens: turns.reduce((n, t) => n + t.usage.totalTokens, 0),
          opinions: data.opinions.filter(
            (o) => !o.sourceRequestId || opinionIds.has(o.sourceRequestId),
          ),
          contextItems: data.contextItems,
          snapshots: [],
        },
      };
      store.put(branch);
      return {
        sessionId: id,
        parent: branch.workspaceData?.parent,
        title: branch.title,
        turns: turns.length,
        profileId: branch.workspaceData?.profileId,
      };
    }
    if (request.operation === "opinion_save") {
      const item = request.opinion;
      if (!item) throw new BridgeError("OPINION_REQUIRED", "Provide a viewpoint or issue record.");
      if (item.sourceRequestId && !session.turns.some((t) => t.requestId === item.sourceRequestId))
        throw new BridgeError("INVALID_SOURCE", "Source round must belong to this discussion.");
      if (item.status !== "proposed" && !item.rationale.trim())
        throw new BridgeError("RATIONALE_REQUIRED", "Adoption decisions require a reason.");
      const existing = data.opinions.find((o) => o.id === item.id);
      if (item.id && !existing)
        throw new BridgeError("OPINION_NOT_FOUND", "Viewpoint record does not exist.");
      if (!existing && data.opinions.length >= 200)
        throw new BridgeError("RECORD_LIMIT", "Discussion already has 200 viewpoint records.");
      const record = {
        ...item,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      data.opinions = existing
        ? data.opinions.map((o) => (o.id === record.id ? record : o))
        : [...data.opinions, record];
    } else if (request.operation === "context_save") {
      const item = request.material;
      if (!item) throw new BridgeError("MATERIAL_REQUIRED", "Provide a selected text material.");
      const existing = data.contextItems.find((m) => m.id === item.id);
      if (item.id && !existing)
        throw new BridgeError("MATERIAL_NOT_FOUND", "Material does not exist.");
      if (!existing && data.contextItems.length >= 100)
        throw new BridgeError("RECORD_LIMIT", "Discussion already has 100 materials.");
      const record = {
        ...item,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
      };
      data.contextItems = existing
        ? data.contextItems.map((m) => (m.id === record.id ? record : m))
        : [...data.contextItems, record];
    } else if (request.operation === "snapshot") {
      if (data.snapshots.length >= 30)
        throw new BridgeError("SNAPSHOT_LIMIT", "Discussion already has 30 snapshots.");
      data.snapshots.push({
        id: randomUUID(),
        title: request.title ?? `Stage ${data.snapshots.length + 1}`,
        createdAt: now,
        throughTurn: session.turns.length,
        markdown: sessionMarkdown(session),
        opinions: structuredClone(data.opinions),
      });
    } else throw new BridgeError("INVALID_OPERATION", "Unsupported workspace operation.");
    session.workspaceData = data;
    store.put(session);
    return { sessionId: session.id, ...data };
  });
}

export function profileConfig(config: Config, id?: string): Config {
  if (!id) return config;
  const profile = config.profiles.find((p) => p.id === id);
  if (!profile)
    throw new BridgeError("PROFILE_NOT_FOUND", "Selected model profile does not exist.");
  return { ...config, director: profile.director };
}
