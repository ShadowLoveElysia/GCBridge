import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const compiled = /\$bunfs|[A-Za-z]:[\\/]~BUN[\\/]/.test(import.meta.dir);
export const projectRoot = compiled
  ? dirname(process.execPath)
  : resolve(process.env.GC_BRIDGE_PROJECT_ROOT ?? resolve(import.meta.dir, ".."));
export function platformDirectories(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "win32") {
    const root = join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "GCBridge");
    return { config: root, data: root, cache: join(root, "Cache") };
  }
  if (platform === "darwin")
    return {
      config: join(home, "Library", "Application Support", "GCBridge"),
      data: join(home, "Library", "Application Support", "GCBridge"),
      cache: join(home, "Library", "Caches", "GCBridge"),
    };
  return {
    config: join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "gc-bridge"),
    data: join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "gc-bridge"),
    cache: join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "gc-bridge"),
  };
}
export const privateConfigDir = () => platformDirectories().config;
export const defaultConfigPath = () =>
  resolve(process.env.GC_BRIDGE_CONFIG ?? join(privateConfigDir(), "config.json"));
export const defaultStorageDir = () => platformDirectories().data;
export const childInvocation = (command: string, args: string[] = []) =>
  compiled ? [command, ...args] : [resolve(import.meta.dir, "cli.ts"), command, ...args];
