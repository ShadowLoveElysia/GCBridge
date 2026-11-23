import { createHash, randomUUID } from "node:crypto";
import type { Message } from "@oh-my-pi/pi-ai";
import type { Bridge } from "./bridge.ts";
import type { Config } from "./config.ts";
import { selectedHistory, selectedMaterials } from "./context.ts";
import type { ControlRequest } from "./control.ts";
import { BridgeError, publicError } from "./errors.ts";
import { discussionSystemPrompt, userPrompt } from "./prompts.ts";
import { requestSchema } from "./protocol.ts";
import type { Store } from "./store.ts";
import type { Turn } from "./types.ts";
import { profileConfig, revision } from "./workspace.ts";

interface Preview {
  id: string;
  kind: "context" | "compare";
  expiresAt: number;
  configHash: string;
  sessionId?: string;
  revision?: string;
  request: ControlRequest;
  systemPrompt: string;
  messages: Message[];
  context?: string;
  selectedTurns: Turn[];
  runningUntil?: number;
  targets: {
    id?: string;
    label: string;
    model: string;
    api: string;
    baseUrl: string;
    requestId: string;
    sessionId?: string;
    result?: unknown;
    error?: { code: string; message: string };
  }[];
  started?: boolean;
  completed?: boolean;
  result?: unknown;
}
const configHash = (config: Config) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        director: config.director,
        discussion: config.discussion,
        profiles: config.profiles,
        limits: config.limits,
      }),
    )
    .digest("hex");
export class Previews {
  constructor(
    private config: Config,
    private store: Store,
    private bridgeFor: (id?: string) => Bridge,
  ) {}

  create(request: ControlRequest, kind: "context" | "compare"): unknown {
    const { workspace: _, profileId: __, profileIds: ___, previewId: ____, ...input } = request;
    const payload = requestSchema.parse({ ...input, operation: "consult" });
    const session = request.sessionId ? this.store.get(request.sessionId) : undefined;
    const history = session ? selectedHistory(session, request) : [];
    if (session?.status === "pending")
      throw new BridgeError("SESSION_BUSY", "Wait for the active round before previewing context.");
    if (!session && ((request.turnIds?.length ?? 0) || (request.contextItemIds?.length ?? 0)))
      throw new BridgeError("SESSION_REQUIRED", "Select a discussion for history or materials.");
    const context = session
      ? selectedMaterials(session, request, request.context)
      : request.context;
    const messages: Message[] = [
      ...history,
      {
        role: "user",
        content: userPrompt(payload.mode, payload.prompt as string, context),
        timestamp: Date.now(),
      },
    ];
    const ids =
      kind === "compare"
        ? request.profileIds
        : [request.profileId ?? session?.workspaceData?.profileId];
    if (!ids?.length || new Set(ids).size !== ids.length)
      throw new BridgeError("TARGETS_REQUIRED", "Choose one to four distinct model profiles.");
    const targets = ids.map((id) => {
      const c = profileConfig(this.config, id);
      return {
        id,
        label: id
          ? (this.config.profiles.find((p) => p.id === id)?.label ?? c.director.model)
          : "Current model",
        model: c.director.model,
        api: c.director.api,
        baseUrl: c.director.baseUrl,
        requestId: randomUUID(),
      };
    });
    const preview: Preview = {
      id: randomUUID(),
      kind,
      expiresAt: Date.now() + 600_000,
      configHash: configHash(this.config),
      sessionId: session?.id,
      revision: session ? revision(session) : undefined,
      request: {
        ...request,
        operation: "consult",
        mode: payload.mode,
        requestId: request.requestId ?? randomUUID(),
      },
      systemPrompt: discussionSystemPrompt(this.config),
      messages,
      context,
      selectedTurns: session
        ? session.turns.filter((t) => !request.turnIds || request.turnIds.includes(t.requestId))
        : [],
      targets,
    };
    this.store.savePreview(preview.id, session?.id, preview);
    return {
      previewId: preview.id,
      expiresAt: preview.expiresAt,
      kind,
      targets: targets.map(({ requestId: _, ...target }) => target),
      systemPrompt: preview.systemPrompt,
      messages,
      estimatedInputBytes: Buffer.byteLength(
        JSON.stringify(messages) + preview.systemPrompt,
        "utf8",
      ),
      paidRequestsOnConfirm: targets.length,
      independent: kind === "compare",
      requiresExplicitSend: true,
    };
  }

  async send(id: string, kind: "context" | "compare", signal?: AbortSignal): Promise<unknown> {
    let preview = this.store.getPreview(id) as Preview;
    if (preview.kind !== kind) throw new BridgeError("INVALID_PREVIEW", "Wrong preview type.");
    if (preview.completed) return preview.result;
    if (preview.configHash !== configHash(this.config))
      throw new BridgeError("PREVIEW_CHANGED", "Configuration changed; preview again.");
    if (!preview.started) {
      if (preview.expiresAt < Date.now())
        throw new BridgeError("PREVIEW_EXPIRED", "Preview expired; select context again.");
      if (preview.sessionId && revision(this.store.get(preview.sessionId)) !== preview.revision)
        throw new BridgeError(
          "PREVIEW_CHANGED",
          "Discussion changed; preview again before sending.",
        );
    }
    this.store.transaction(() => {
      const current = this.store.getPreview(id) as Preview;
      if (
        kind === "context" &&
        current.sessionId &&
        !this.store.request(current.request.requestId as string) &&
        revision(this.store.get(current.sessionId)) !== current.revision
      )
        throw new BridgeError(
          "PREVIEW_CHANGED",
          "Discussion changed before dispatch; preview again.",
        );
      if ((current.runningUntil ?? 0) > Date.now())
        throw new BridgeError(
          "PREVIEW_BUSY",
          "This preview is already being sent; do not submit it twice.",
        );
      current.started = true;
      current.runningUntil = Date.now() + this.config.limits.timeoutMs * 4 + 30_000;
      this.store.savePreview(id, current.sessionId, current);
      preview = current;
    });
    try {
      if (kind === "context") {
        const { workspace: _, profileId: __, ...raw } = preview.request;
        const { profileIds: ___, previewId: ____, ...request } = raw;
        const result = await this.bridgeFor(preview.targets[0]?.id).dispatch(request, signal);
        if (
          result &&
          typeof result === "object" &&
          "sessionId" in result &&
          typeof result.sessionId === "string"
        ) {
          this.store.select(preview.request.workspace ?? "default", result.sessionId);
          const profileId = preview.targets[0]?.id;
          if (profileId) {
            const session = this.store.get(result.sessionId);
            session.workspaceData ??= { opinions: [], contextItems: [], snapshots: [] };
            session.workspaceData.profileId = profileId;
            this.store.put(session);
          }
        }
        preview.completed = true;
        preview.result = result;
        if (
          result &&
          typeof result === "object" &&
          "sessionId" in result &&
          typeof result.sessionId === "string"
        )
          preview.sessionId = result.sessionId;
        this.store.savePreview(id, preview.sessionId, preview);
        return result;
      }
      // Each model gets a fresh session plus the same explicitly previewed material.
      // Targets are serialized to respect the existing global inference limit.
      for (let i = 0; i < preview.targets.length; i++) {
        preview = this.store.getPreview(id) as Preview;
        const target = preview.targets[i];
        if (!target || target.result || target.error) continue;
        signal?.throwIfAborted();
        const bridge = this.bridgeFor(target.id);
        if (!target.sessionId) {
          const created = (await bridge.dispatch({
            operation: "new",
            title: `Independent · ${target.label}`,
          })) as { sessionId: string };
          target.sessionId = created.sessionId;
          const session = this.store.get(created.sessionId);
          session.messages = structuredClone(preview.messages.slice(0, -1));
          session.turns = structuredClone(preview.selectedTurns);
          session.totalTokens = session.turns.reduce((n, t) => n + t.usage.totalTokens, 0);
          session.workspaceData = {
            opinions: [],
            contextItems: [],
            snapshots: [],
            profileId: target.id,
          };
          this.store.put(session);
          this.store.savePreview(id, preview.sessionId, preview);
        }
        try {
          target.result = await bridge.dispatch(
            {
              operation: "consult",
              sessionId: target.sessionId,
              requestId: target.requestId,
              mode: preview.request.mode,
              prompt: preview.request.prompt,
              context: preview.context,
            },
            signal,
          );
        } catch (error) {
          target.error = publicError(error);
        }
        this.store.savePreview(id, preview.sessionId, preview);
      }
      preview = this.store.getPreview(id) as Preview;
      const result = {
        previewId: id,
        independent: true,
        results: preview.targets.map((t) => ({
          profileId: t.id,
          label: t.label,
          model: t.model,
          sessionId: t.sessionId,
          result: t.result,
          error: t.error,
        })),
        automaticSynthesis: false,
      };
      preview.completed = true;
      preview.result = result;
      this.store.savePreview(id, preview.sessionId, preview);
      return result;
    } finally {
      const current = this.store.getPreview(id) as Preview;
      current.runningUntil = 0;
      this.store.savePreview(id, current.sessionId, current);
    }
  }
}
