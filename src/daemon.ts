import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Bridge } from "./bridge.ts";
import { loadConfig } from "./config.ts";
import { controlSchema } from "./control.ts";
import { publicError } from "./errors.ts";
import { HeadlessOmp } from "./headless.ts";
import { writePrivate } from "./private-files.ts";
import { DiscussionService } from "./service.ts";
import { Store } from "./store.ts";

export const statePath = (storage: string) => join(storage, "daemon.json");
export interface DaemonState {
  instanceId: string;
  token: string;
  port: number;
  pid: number;
  startedAt: string;
  configPath: string;
}
export function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided),
    b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function runDaemon(configPath: string) {
  const config = await loadConfig(configPath);
  const store = new Store(config.storageDir);
  const director = new HeadlessOmp(config);
  const service = new DiscussionService(
    new Bridge(config, store, director),
    store,
    director,
    config,
  );
  const instanceId = randomUUID(),
    token = randomUUID() + randomUUID();
  let stopping = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 12_000_000,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.headers.get("origin") ||
        url.hostname !== "127.0.0.1" ||
        !tokenMatches(request.headers.get("authorization"), token)
      )
        return new Response(null, { status: 403 });
      if (request.method === "GET" && url.pathname === "/status")
        return Response.json({
          running: !stopping,
          pid: process.pid,
          instanceId,
          model: config.director.model,
          api: config.director.api,
          startedAt: state.startedAt,
          runtime: "Oh My Pi Agent 19.1.1 (headless)",
          inferenceOnStart: false,
        });
      if (request.method === "POST" && url.pathname === "/stop") {
        if (!stopping) {
          stopping = true;
          setTimeout(() => {
            void shutdown();
          }, 20);
        }
        return Response.json({ running: false, stopping: true });
      }
      if (request.method !== "POST" || url.pathname !== "/dispatch" || stopping)
        return new Response(null, { status: 404 });
      try {
        const parsed = controlSchema.safeParse(await request.json());
        if (!parsed.success || ["start", "status", "stop"].includes(parsed.data.operation))
          return Response.json(
            { error: { code: "INVALID_REQUEST", message: "Invalid discussion operation." } },
            { status: 400 },
          );
        const result = await service.dispatch(parsed.data, request.signal);
        return Response.json({ result });
      } catch (error) {
        return Response.json({ error: publicError(error) }, { status: 400 });
      }
    },
  });
  const state: DaemonState = {
    instanceId,
    token,
    port: server.port as number,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    configPath,
  };
  async function shutdown() {
    service.abort();
    await server.stop(true);
    try {
      const current = JSON.parse(
        await readFile(statePath(config.storageDir), "utf8"),
      ) as DaemonState;
      if (current.instanceId === instanceId)
        await rm(statePath(config.storageDir), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") process.exitCode = 1;
    }
    process.exit();
  }
  await writePrivate(statePath(config.storageDir), state);
  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });
}

if (import.meta.main) {
  runDaemon(process.argv[2] ?? "").catch(() => {
    process.exitCode = 1;
  });
}
