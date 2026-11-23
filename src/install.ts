import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { assetText } from "./assets.ts";
import { type CodexTarget, detectCodex } from "./codex-detection.ts";
import { guardedConfigWrite } from "./config-write.ts";
import { BridgeError } from "./errors.ts";
import { compiled, projectRoot } from "./paths.ts";
import { writePrivate } from "./private-files.ts";

export function injectedConfig(original: string, command: string, args: string[]) {
  const lines = original.split(/\r?\n/);
  let inSection = false;
  const retained: string[] = [];
  for (const line of lines) {
    if (/^\s*\[/.test(line))
      inSection = /^\s*\[mcp_servers\.gc_bridge(?:\.[^\]]+)?\]\s*$/.test(line);
    if (!inSection) retained.push(line);
  }
  const block = `[mcp_servers.gc_bridge]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 2500\n`;
  const next = `${retained.join("\n").trimEnd()}\n\n${block}`;
  try {
    Bun.TOML.parse(next);
  } catch {
    throw new BridgeError(
      "INVALID_CODEX_CONFIG",
      "Codex configuration is not valid TOML; nothing was changed.",
    );
  }
  return next;
}
export async function writeCodexRoot(root: string, command: string, args: string[]) {
  const configPath = join(root, "config.toml");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await guardedConfigWrite(configPath, (original) => injectedConfig(original, command, args));
  const skillDir = join(root, "skills/gc");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), await assetText("skills/gc/SKILL.md"));
  return { configPath, skillPath: join(skillDir, "SKILL.md") };
}
// Kept for source integrations that passed the user's home rather than CODEX_HOME.
export const updateCodex = (home: string, command: string, args: string[]) =>
  writeCodexRoot(join(home, ".codex"), command, args);
export function connectionCommand(target: CodexTarget): { command: string; args: string[] } {
  if (process.platform === "win32" && target.environment === "wsl") {
    const windowsEntry = compiled ? process.execPath : join(projectRoot, "launch.sh");
    let linuxEntry: string;
    try {
      linuxEntry = execFileSync(
        "wsl.exe",
        ["-d", target.distribution as string, "--cd", "~", "--exec", "wslpath", "-u", windowsEntry],
        { timeout: 8000 },
      )
        .toString()
        .trim();
    } catch {
      throw new BridgeError(
        "WSL_PATH",
        "Cannot map the application path into this WSL distribution.",
      );
    }
    if (compiled) {
      try {
        execFileSync(
          "wsl.exe",
          ["-d", target.distribution as string, "--cd", "~", "--exec", linuxEntry, "components"],
          { timeout: 15000, stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch {
        throw new BridgeError(
          "WSL_INTEROP",
          "This WSL environment cannot run the Windows GCBridge executable. Enable Windows interop, or install a native Linux GCBridge build inside that distribution.",
        );
      }
    }
    return compiled
      ? { command: linuxEntry, args: ["mcp"] }
      : { command: "bash", args: [linuxEntry, "mcp"] };
  }
  if (target.environment === "windows" && process.env.WSL_DISTRO_NAME)
    return {
      command: "wsl.exe",
      args: [
        "-d",
        process.env.WSL_DISTRO_NAME,
        "--exec",
        ...(compiled ? [process.execPath, "mcp"] : ["bash", join(projectRoot, "launch.sh"), "mcp"]),
      ],
    };
  return compiled
    ? { command: process.execPath, args: ["mcp"] }
    : {
        command: process.platform === "win32" ? process.execPath : "bash",
        args:
          process.platform === "win32"
            ? [join(projectRoot, "src/cli.ts"), "mcp"]
            : [join(projectRoot, "launch.sh"), "mcp"],
      };
}
function wslWrite(target: CodexTarget, path: string, content: string, expected?: string) {
  const script = `set -eu
 umask 077
 mkdir -p -- "$(dirname -- "$1")"
 lock="$1.gc-bridge.lock"
 if ! mkdir -- "$lock" 2>/dev/null; then exit 73; fi
 temporary="$1.gc-bridge.$$.tmp"
 trap 'rm -f -- "$temporary"; rmdir -- "$lock"' EXIT
 current="$(if [ -f "$1" ]; then sha256sum -- "$1" | cut -d ' ' -f 1; else printf '' | sha256sum | cut -d ' ' -f 1; fi)"
 if [ "$2" != '-' ] && [ "$current" != "$2" ]; then exit 74; fi
 cat > "$temporary"
 current="$(if [ -f "$1" ]; then sha256sum -- "$1" | cut -d ' ' -f 1; else printf '' | sha256sum | cut -d ' ' -f 1; fi)"
 if [ "$2" != '-' ] && [ "$current" != "$2" ]; then exit 74; fi
 mv -- "$temporary" "$1"`;
  execFileSync(
    "wsl.exe",
    [
      "-d",
      target.distribution as string,
      "--cd",
      "~",
      "--exec",
      "sh",
      "-c",
      script,
      "gcbridge",
      path,
      expected ?? "-",
    ],
    { input: content, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
  );
}
export async function installCodex(selection?: { targetId: string; configRoot?: string }) {
  const detected = await detectCodex();
  if (!selection) return { ...detected, requiresSelection: true, backgroundAutoStart: false };
  const target = detected.targets.find((t) => t.id === selection.targetId);
  if (!target)
    throw new BridgeError("TARGET_NOT_FOUND", "Select a detected Codex environment again.");
  const root = selection.configRoot?.trim() || target.configRoot;
  if (
    target.environment === "wsl" && process.platform === "win32"
      ? !root.startsWith("/")
      : !isAbsolute(root)
  )
    throw new BridgeError(
      "CONFIG_PATH",
      "Choose an absolute config directory in the selected target's operating system.",
    );
  if (/[\r\n\0]/.test(root))
    throw new BridgeError("CONFIG_PATH", "Invalid configuration directory.");
  const launch = connectionCommand(target);
  let result: { configPath: string; skillPath: string };
  if (target.environment === "wsl" && process.platform === "win32") {
    const configPath = `${root.replace(/\/$/, "")}/config.toml`;
    let original = "";
    try {
      original = execFileSync(
        "wsl.exe",
        [
          "-d",
          target.distribution as string,
          "--exec",
          "sh",
          "-c",
          'if [ -f "$1" ]; then cat -- "$1"; fi',
          "gcbridge",
          configPath,
        ],
        { timeout: 8000, encoding: "utf8" },
      );
    } catch {
      throw new BridgeError("WSL_READ", "Cannot read the selected WSL configuration.");
    }
    try {
      wslWrite(
        target,
        configPath,
        injectedConfig(original, launch.command, launch.args),
        createHash("sha256").update(original).digest("hex"),
      );
      wslWrite(target, `${root}/skills/gc/SKILL.md`, await assetText("skills/gc/SKILL.md"));
    } catch {
      throw new BridgeError(
        "WSL_WRITE",
        "Cannot write selected WSL config; verify permissions and Windows interop availability.",
      );
    }
    result = { configPath, skillPath: `${root}/skills/gc/SKILL.md` };
  } else result = await writeCodexRoot(resolve(root), launch.command, launch.args);
  if (!(target.environment === "wsl" && process.platform === "win32"))
    await writePrivate(join(root, "gc-bridge-connection.json"), {
      targetId: target.id,
      kind: target.kind,
      environment: target.environment,
      distribution: target.distribution,
      command: launch.command,
      args: launch.args,
      injectedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
    });
  return {
    installed: true,
    target: { id: target.id, label: target.label },
    ...result,
    sharedConfig: target.sharedConfig,
    sharedConfigNotice: target.sharedConfig
      ? "CLI/Desktop may read this same config; injection affects both readers."
      : undefined,
    requiresClientRestart: true,
    backgroundAutoStart: false,
    skillInvocation: "$gc start",
    nativeSlashAlias: false,
    transport: launch,
  };
}
