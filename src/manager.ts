import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Bridge } from "./bridge.ts";
import { credentialPresent, loadConfig } from "./config.ts";
import { type ControlRequest, controlSchema } from "./control.ts";
import { type DaemonState, statePath } from "./daemon.ts";
import { BridgeError } from "./errors.ts";
import { childInvocation, defaultConfigPath } from "./paths.ts";
import { OmpProvider } from "./provider.ts";
import { DiscussionService } from "./service.ts";
import { Store } from "./store.ts";

export class Manager {
  readonly configPath: string;
  constructor(configPath?: string) {
    this.configPath = resolve(configPath ?? defaultConfigPath());
  }

  async endpoint(): Promise<DaemonState | null> {
    const config = await loadConfig(this.configPath);
    try {
      const info = await stat(statePath(config.storageDir));
      if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
        throw new BridgeError("STATE_PERMISSIONS", "Background state must be private (chmod 600).");
      const state = JSON.parse(await readFile(statePath(config.storageDir), "utf8")) as DaemonState;
      if (
        !Number.isInteger(state.port) ||
        state.port < 1 ||
        state.port > 65535 ||
        typeof state.token !== "string"
      )
        return null;
      const response = await fetch(`http://127.0.0.1:${state.port}/status`, {
        headers: { Authorization: `Bearer ${state.token}` },
        signal: AbortSignal.timeout(1500),
        redirect: "error",
      });
      if (!response.ok) return null;
      const status = (await response.json()) as { instanceId?: string };
      return status.instanceId === state.instanceId ? state : null;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      return null;
    }
  }

  async status(): Promise<unknown> {
    const endpoint = await this.endpoint();
    if (!endpoint) return { running: false, defaultEnabled: false };
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/status`, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    return response.json();
  }

  async start(): Promise<unknown> {
    if (await this.endpoint()) return this.status();
    const config = await loadConfig(this.configPath);
    if (!(await credentialPresent(config)))
      throw new BridgeError(
        "MISSING_CREDENTIAL",
        "Save a collaborator key in the GUI before starting Bridge.",
      );
    await mkdir(config.storageDir, { recursive: true, mode: 0o700 });
    const lockPath = join(config.storageDir, "startup.lock");
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    try {
      lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(String(process.pid));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = Date.now() - (await stat(lockPath)).mtimeMs;
      if (age > 30_000) {
        await rm(lockPath, { force: true });
        return this.start();
      }
      for (let i = 0; i < 100; i++) {
        await delay(100);
        if (await this.endpoint()) return this.status();
      }
      throw new BridgeError(
        "START_BUSY",
        "Another startup is in progress. Check status in a moment.",
      );
    }
    try {
      if (await this.endpoint()) return this.status();
      const child = spawn(
        process.execPath,
        childInvocation("daemon", ["--config", this.configPath]),
        { detached: true, stdio: "ignore", env: { ...process.env } },
      );
      let failed = false;
      child.on("error", () => {
        failed = true;
      });
      child.unref();
      for (let i = 0; i < 120; i++) {
        await delay(100);
        if (await this.endpoint()) return this.status();
        if (failed || child.exitCode !== null) break;
      }
      throw new BridgeError(
        "START_FAILED",
        "Headless Oh My Pi did not become ready. Check Bun runtime, dependencies and private storage permissions.",
      );
    } finally {
      await lock?.close();
      await rm(lockPath, { force: true });
    }
  }

  async dispatch(raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const parsed = controlSchema.safeParse(raw);
    if (!parsed.success) throw new BridgeError("INVALID_REQUEST", "Invalid GC Bridge arguments.");
    const request = parsed.data;
    if (request.operation === "start") return this.start();
    if (request.operation === "status") return this.status();
    const endpoint = await this.endpoint();
    if (request.operation === "stop") {
      if (!endpoint) return { running: false };
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${endpoint.token}` },
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      if (!response.ok) throw new BridgeError("STOP_FAILED", "Background stop failed.");
      for (let i = 0; i < 40; i++) {
        await delay(100);
        if (!(await this.endpoint())) return { running: false };
      }
      throw new BridgeError("STOP_PENDING", "Background is shutting down; check status again.");
    }
    if (endpoint) return this.remote(endpoint, request, signal);
    if (request.operation === "consult" || request.operation === "compare")
      throw new BridgeError(
        "BRIDGE_DISABLED",
        "Bridge is off. Run gc start explicitly before discussing a project.",
      );
    const config = await loadConfig(this.configPath),
      store = new Store(config.storageDir);
    const local = new DiscussionService(
      new Bridge(config, store, new OmpProvider(config)),
      store,
      undefined,
      config,
    );
    try {
      return await local.dispatch(request, signal);
    } finally {
      local.close();
    }
  }

  private async remote(
    endpoint: DaemonState,
    request: ControlRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const config = await loadConfig(this.configPath);
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([
        AbortSignal.timeout(
          config.limits.timeoutMs * (request.operation === "compare" ? 4 : 1) + 10_000,
        ),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    });
    const value = (await response.json()) as {
      result?: unknown;
      error?: { code: string; message: string };
    };
    if (value.error) throw new BridgeError(value.error.code, value.error.message);
    if (!response.ok) throw new BridgeError("BACKGROUND_ERROR", "Background request failed.");
    return value.result;
  }
}
