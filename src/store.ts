import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@oh-my-pi/pi-ai";
import { BridgeError } from "./errors.ts";
import type { Turn } from "./types.ts";
import type { WorkspaceData } from "./workspace-types.ts";

export interface Session {
  id: string;
  title: string;
  fingerprint: string;
  status: "ready" | "pending" | "interrupted" | "closed";
  messages: Message[];
  turns: Turn[];
  totalTokens: number;
  leaseUntil: number;
  pendingRequestId?: string;
  createdAt: string;
  updatedAt: string;
  workspaceData?: WorkspaceData;
}
interface RequestRow {
  session_id: string;
  digest: string;
  status: string;
  result: string | null;
}

export class Store {
  private db: Database;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const databasePath = join(directory, "bridge.sqlite");
    this.db = new Database(databasePath, { create: true });
    if (process.platform !== "win32") chmodSync(databasePath, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    const version = this.db.query("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version > 3)
      throw new BridgeError("STORAGE_VERSION", "Storage was created by a newer GC_Bridge version.");
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS selections (workspace TEXT PRIMARY KEY, session_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deletion_confirmations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, fingerprint TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS request_selections (id TEXT PRIMARY KEY, digest TEXT NOT NULL, session_id TEXT);
      CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, session_id TEXT, state TEXT NOT NULL);
      PRAGMA user_version=3;`);
  }

  transaction<T>(action: () => T): T {
    return this.db.transaction(action).immediate();
  }

  get(id: string): Session {
    const row = this.db.query("SELECT state FROM sessions WHERE id=?").get(id) as {
      state: string;
    } | null;
    if (!row)
      throw new BridgeError(
        "SESSION_NOT_FOUND",
        "Session does not exist in this storage directory.",
      );
    return JSON.parse(row.state) as Session;
  }

  put(session: Session): void {
    session.updatedAt = new Date().toISOString();
    this.db
      .query(
        "INSERT INTO sessions(id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      )
      .run(session.id, JSON.stringify(session));
  }

  list(): Array<
    Pick<Session, "id" | "title" | "status" | "totalTokens" | "updatedAt"> & { turns: number }
  > {
    return (
      this.db
        .query(
          "SELECT state FROM sessions ORDER BY json_extract(state, '$.updatedAt') DESC LIMIT 100",
        )
        .all() as { state: string }[]
    ).map((row) => {
      const s = JSON.parse(row.state) as Session;
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        totalTokens: s.totalTokens,
        updatedAt: s.updatedAt,
        turns: s.turns.length,
      };
    });
  }

  pendingCount(): number {
    return (
      this.db
        .query(
          "SELECT count(*) AS n FROM sessions WHERE json_extract(state,'$.status')='pending' AND json_extract(state,'$.leaseUntil')>?",
        )
        .get(Date.now()) as { n: number }
    ).n;
  }

  request(id: string): RequestRow | null {
    return this.db.query("SELECT * FROM requests WHERE id=?").get(id) as RequestRow | null;
  }

  reserve(id: string, sessionId: string, digest: string): void {
    this.db
      .query("INSERT INTO requests(id,session_id,digest,status) VALUES (?,?,?,'pending')")
      .run(id, sessionId, digest);
  }

  finish(id: string, status: "completed" | "failed", result: unknown): void {
    this.db
      .query("UPDATE requests SET status=?,result=? WHERE id=?")
      .run(status, JSON.stringify(result), id);
  }

  interruptRequests(sessionId: string): void {
    this.db
      .query("UPDATE requests SET status='failed',result=? WHERE session_id=? AND status='pending'")
      .run(
        JSON.stringify({
          code: "INTERRUPTED",
          message: "Previous request was interrupted; its upstream outcome and cost are unknown.",
        }),
        sessionId,
      );
  }

  close(): void {
    this.db.close();
  }

  selection(workspace: string): string | undefined {
    return (
      this.db.query("SELECT session_id FROM selections WHERE workspace=?").get(workspace) as {
        session_id: string;
      } | null
    )?.session_id;
  }

  bindSelection(id: string, digest: string, sessionId?: string): string | undefined {
    return this.transaction(() => {
      const existing = this.db
        .query("SELECT digest,session_id FROM request_selections WHERE id=?")
        .get(id) as { digest: string; session_id: string | null } | null;
      if (existing) {
        if (existing.digest !== digest)
          throw new BridgeError(
            "IDEMPOTENCY_CONFLICT",
            "This requestId belongs to different project arguments.",
          );
        return existing.session_id ?? undefined;
      }
      this.db
        .query("INSERT INTO request_selections(id,digest,session_id) VALUES (?,?,?)")
        .run(id, digest, sessionId ?? null);
      return sessionId;
    });
  }

  select(workspace: string, sessionId?: string): void {
    if (sessionId)
      this.db
        .query(
          "INSERT INTO selections(workspace,session_id) VALUES (?,?) ON CONFLICT(workspace) DO UPDATE SET session_id=excluded.session_id",
        )
        .run(workspace, sessionId);
    else this.db.query("DELETE FROM selections WHERE workspace=?").run(workspace);
  }

  previewDelete(id: string) {
    const session = this.get(id);
    if (
      this.db
        .query(
          "SELECT id FROM previews WHERE session_id=? AND COALESCE(json_extract(state,'$.runningUntil'),0)>? LIMIT 1",
        )
        .get(id, Date.now())
    )
      throw new BridgeError(
        "SESSION_BUSY",
        "A selected-context request is running; wait before deleting its source discussion.",
      );
    if (session.status === "pending")
      throw new BridgeError(
        "SESSION_BUSY",
        "Recover or finish the pending session before deleting it.",
      );
    const confirmationId = randomUUID();
    const expiresAt = Date.now() + 300_000;
    this.db.query("DELETE FROM deletion_confirmations WHERE expires<?").run(Date.now());
    this.db
      .query("INSERT INTO deletion_confirmations VALUES (?,?,?,?)")
      .run(
        confirmationId,
        id,
        createHash("sha256").update(JSON.stringify(session)).digest("hex"),
        expiresAt,
      );
    return {
      sessionId: id,
      title: session.title,
      turns: session.turns.length,
      confirmationId,
      expiresAt,
      requiresUserConfirmation: true,
      consequence:
        "Permanently delete this session, selected context and guidance. This does not refund provider charges.",
    };
  }

  deleteConfirmed(id: string, confirmationId: string) {
    const session = this.get(id);
    if (
      this.db
        .query(
          "SELECT id FROM previews WHERE session_id=? AND COALESCE(json_extract(state,'$.runningUntil'),0)>? LIMIT 1",
        )
        .get(id, Date.now())
    )
      throw new BridgeError(
        "SESSION_BUSY",
        "A selected-context request is running; wait before deleting its source discussion.",
      );
    const row = this.db
      .query("SELECT * FROM deletion_confirmations WHERE id=?")
      .get(confirmationId) as { session_id: string; fingerprint: string; expires: number } | null;
    if (
      !row ||
      row.session_id !== id ||
      row.expires < Date.now() ||
      row.fingerprint !== createHash("sha256").update(JSON.stringify(session)).digest("hex")
    )
      throw new BridgeError(
        "CONFIRMATION_REQUIRED",
        "Deletion preview expired or session changed. Preview and confirm again.",
      );
    if (session.status === "pending")
      throw new BridgeError("SESSION_BUSY", "Pending sessions cannot be deleted.");
    this.db
      .query(
        "DELETE FROM request_selections WHERE id IN (SELECT id FROM requests WHERE session_id=?)",
      )
      .run(id);
    this.db.query("DELETE FROM requests WHERE session_id=?").run(id);
    this.db.query("DELETE FROM request_selections WHERE session_id=?").run(id);
    this.db.query("DELETE FROM selections WHERE session_id=?").run(id);
    this.db.query("DELETE FROM deletion_confirmations WHERE session_id=?").run(id);
    this.db.query("DELETE FROM sessions WHERE id=?").run(id);
    this.db.query("DELETE FROM previews WHERE session_id=?").run(id);
    return { sessionId: id, deleted: true };
  }

  savePreview(id: string, sessionId: string | undefined, state: unknown): void {
    this.db
      .query(
        "INSERT INTO previews(id,session_id,state) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,state=excluded.state",
      )
      .run(id, sessionId ?? null, JSON.stringify(state));
  }
  getPreview(id: string): unknown {
    const row = this.db.query("SELECT state FROM previews WHERE id=?").get(id) as {
      state: string;
    } | null;
    if (!row) throw new BridgeError("PREVIEW_NOT_FOUND", "Preview is missing or was deleted.");
    return JSON.parse(row.state);
  }
}
