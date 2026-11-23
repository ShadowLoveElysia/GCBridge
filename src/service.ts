import { createHash } from "node:crypto";
import { Bridge } from "./bridge.ts";
import type { Config } from "./config.ts";
import type { ControlRequest } from "./control.ts";
import { toBridgeRequest } from "./control.ts";
import { BridgeError } from "./errors.ts";
import type { HeadlessOmp } from "./headless.ts";
import { HeadlessOmp as Collaborator } from "./headless.ts";
import { Previews } from "./preview.ts";
import { OmpProvider } from "./provider.ts";
import type { Store } from "./store.ts";
import {
  profileConfig,
  sessionMarkdown,
  workspaceDispatch,
  workspaceOperations,
} from "./workspace.ts";

/** Project selection affects dialogue only; it never reads project paths. */
export class DiscussionService {
  private profiles = new Map<string, Bridge>();
  private previews?: Previews;
  constructor(
    private bridge: Bridge,
    private store: Store,
    private director?: HeadlessOmp,
    private config?: Config,
  ) {
    if (config) this.previews = new Previews(config, store, (id) => this.bridgeFor(id));
  }
  private bridgeFor(id?: string): Bridge {
    if (!id || !this.config) return this.bridge;
    let bridge = this.profiles.get(id);
    if (!bridge) {
      const config = profileConfig(this.config, id);
      bridge = new Bridge(
        config,
        this.store,
        this.director ? new Collaborator(config) : new OmpProvider(config),
      );
      this.profiles.set(id, bridge);
    }
    return bridge;
  }
  async dispatch(request: ControlRequest, signal?: AbortSignal): Promise<unknown> {
    const workspace = request.workspace ?? "default";
    if (["context_preview", "compare_preview"].includes(request.operation) && !request.sessionId)
      request = { ...request, sessionId: this.store.selection(workspace) };
    if (this.config && workspaceOperations.has(request.operation)) {
      const result = workspaceDispatch(this.store, this.config, request);
      if (request.operation === "branch")
        this.store.select(workspace, (result as { sessionId: string }).sessionId);
      return result;
    }
    if (request.operation === "context_preview" || request.operation === "compare_preview")
      return this.previews?.create(
        request,
        request.operation === "context_preview" ? "context" : "compare",
      );
    if (request.operation === "compare" || (request.operation === "consult" && request.previewId)) {
      if (!request.previewId)
        throw new BridgeError("PREVIEW_REQUIRED", "A preview ID is required before sending.");
      return this.previews?.send(
        request.previewId,
        request.operation === "compare" ? "compare" : "context",
        signal,
      );
    }
    if (request.operation === "consult" && !request.sessionId) {
      const selected = this.store.selection(workspace);
      const sessionId = request.requestId
        ? this.store.bindSelection(
            request.requestId,
            createHash("sha256").update(JSON.stringify(request)).digest("hex"),
            selected,
          )
        : selected;
      request = { ...request, sessionId };
    }
    if (request.operation === "export" && request.sessionId)
      return {
        sessionId: request.sessionId,
        markdown: sessionMarkdown(this.store.get(request.sessionId)),
      };
    const profileId =
      request.profileId ??
      (request.sessionId ? this.store.get(request.sessionId).workspaceData?.profileId : undefined);
    const result = await this.bridgeFor(profileId).dispatch(toBridgeRequest(request), signal);
    if (
      result &&
      typeof result === "object" &&
      "sessionId" in result &&
      typeof result.sessionId === "string"
    ) {
      if (["new", "resume", "consult"].includes(request.operation))
        this.store.select(workspace, result.sessionId);
      if (request.profileId && ["new", "consult"].includes(request.operation)) {
        const session = this.store.get(result.sessionId);
        if (!session.workspaceData)
          session.workspaceData = { opinions: [], contextItems: [], snapshots: [] };
        session.workspaceData.profileId = request.profileId;
        this.store.put(session);
      }
      if (request.operation === "delete") this.director?.forget(result.sessionId);
    }
    return result;
  }
  abort(): void {
    this.bridge.abort();
    for (const bridge of this.profiles.values()) bridge.abort();
  }
  close(): void {
    this.bridge.close();
  }
}
