import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { BridgeError } from "./errors.ts";

export async function readConfigFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
export async function guardedConfigWrite(
  path: string,
  transform: (value: string) => string,
): Promise<void> {
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(`${path}.gc-bridge.lock`, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new BridgeError(
        "CONFIG_BUSY",
        "Another GCBridge injection is writing this configuration. Retry after it finishes.",
      );
    throw error;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const original = await readConfigFile(path),
      fingerprint = createHash("sha256").update(original).digest("hex"),
      next = transform(original);
    if (next === original) return;
    await Bun.write(temporary, next);
    if (process.platform !== "win32") {
      const { chmod } = await import("node:fs/promises");
      await chmod(temporary, 0o600);
    }
    if (
      createHash("sha256")
        .update(await readConfigFile(path))
        .digest("hex") !== fingerprint
    )
      throw new BridgeError(
        "CONFIG_CHANGED",
        "Codex configuration changed during injection. Nothing was overwritten; refresh and try again.",
      );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(`${path}.gc-bridge.lock`, { force: true });
  }
}
