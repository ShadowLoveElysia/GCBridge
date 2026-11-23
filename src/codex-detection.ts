import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export interface CodexTarget {
  id: string;
  kind: "cli" | "desktop";
  environment: "native" | "wsl" | "windows";
  label: string;
  detected: boolean;
  executable?: string;
  configRoot: string;
  configExists: boolean;
  distribution?: string;
  sharedConfig?: boolean;
  detail?: string;
  connectionStatus?: string;
}
const windowsTool = (name: string) => Bun.which(name) ?? `/mnt/c/Windows/System32/${name}`;
const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const decode = (buffer: Buffer) =>
  buffer.includes(0)
    ? buffer
        .toString("utf16le")
        .replace(/^\uFEFF/, "")
        .trim()
    : buffer.toString("utf8").trim();
export function hostCodexRoot(home = homedir(), override = process.env.CODEX_HOME) {
  return resolve(override?.trim() || join(home, ".codex"));
}
export async function findCli(): Promise<string | undefined> {
  const dirs = (process.env.PATH ?? "").split(delimiter);
  const candidates =
    process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex.ps1", "codex"] : ["codex"];
  for (const dir of dirs)
    for (const name of candidates) {
      const path = join(dir, name);
      if (await exists(path)) return path;
    }
  const extra =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", join(homedir(), ".local/bin/codex")]
      : process.platform === "win32"
        ? [
            join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), "npm/codex.cmd"),
            join(homedir(), ".local/bin/codex.exe"),
          ]
        : [join(homedir(), ".local/bin/codex")];
  for (const path of extra) if (await exists(path)) return path;
  return undefined;
}
async function desktopPath(): Promise<string | undefined> {
  if (process.platform === "darwin") {
    for (const app of ["/Applications/Codex.app", join(homedir(), "Applications/Codex.app")])
      if (await exists(app)) return app;
    try {
      const found = execFileSync("mdfind", ["kMDItemFSName == 'Codex.app'"], {
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .split("\n")
        .find((path) => path.endsWith("/Codex.app"));
      if (found && (await exists(found))) return found;
    } catch {
      /* Spotlight is optional; manual configuration remains available. */
    }
    return undefined;
  }
  if (process.platform === "win32") {
    try {
      const result = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-AppxPackage *Codex* | Select-Object -First 1 -ExpandProperty InstallLocation",
        ],
        { timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
      )
        .toString()
        .trim();
      if (result) return result;
    } catch {}
    for (const path of [
      join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"),
        "Programs/Codex/Codex.exe",
      ),
      join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "Codex/Codex.exe"),
    ])
      if (await exists(path)) return path;
  }
  // Linux Desktop installation layout is not standardized; do not infer it from CLI presence.
  return undefined;
}
export const wslProbe =
  'printf "GC_HOME=%s\\n" "$HOME"; printf "GC_CODEX_HOME=%s\\n" "$CODEX_HOME"; printf "GC_CLI=%s\\n" "$(command -v codex 2>/dev/null || true)"; if [ -n "$CODEX_HOME" ]; then GC_ROOT="$CODEX_HOME"; else GC_ROOT="$HOME/.codex"; fi; if [ -f "$GC_ROOT/config.toml" ]; then printf "GC_CONFIG_EXISTS=1\\n"; fi';
function fields(text: string) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("GC_"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}
export async function detectCodex(): Promise<{
  platform: string;
  architecture: string;
  targets: CodexTarget[];
  warnings: string[];
}> {
  const targets: CodexTarget[] = [],
    warnings: string[] = [];
  const root = hostCodexRoot(),
    cli = await findCli(),
    desktop = await desktopPath(),
    configExists = await exists(join(root, "config.toml"));
  targets.push({
    id: "native-cli",
    kind: "cli",
    environment: "native",
    label: `${process.platform} Codex CLI`,
    detected: !!cli,
    executable: cli,
    configRoot: root,
    configExists,
  });
  targets.push({
    id: "native-desktop",
    kind: "desktop",
    environment: "native",
    label: `${process.platform} Codex Desktop`,
    detected: !!desktop,
    executable: desktop,
    configRoot: root,
    configExists,
    detail:
      process.platform === "linux"
        ? "未标准化的 Linux Desktop 路径请手动确认；不能由 CLI 存在推断 Desktop 已安装。"
        : undefined,
  });
  if (process.platform === "win32") {
    try {
      const names = decode(
        execFileSync("wsl.exe", ["--list", "--quiet"], {
          timeout: 8000,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      )
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(
          (name) => !!name && !/^docker-desktop(?:-data)?$|^podman-machine-default$/i.test(name),
        );
      for (const distribution of names) {
        try {
          const f = fields(
            decode(
              execFileSync(
                "wsl.exe",
                ["-d", distribution, "--cd", "~", "--exec", "sh", "-lc", wslProbe],
                {
                  timeout: 10000,
                  stdio: ["ignore", "pipe", "ignore"],
                },
              ),
            ),
          );
          if (!f.GC_HOME?.startsWith("/")) continue;
          const configRoot = f.GC_CODEX_HOME || `${f.GC_HOME}/.codex`;
          if (!configRoot.startsWith("/") || /^[A-Za-z]:/.test(configRoot)) {
            warnings.push(`${distribution}: CODEX_HOME 不是 Linux 绝对路径，需手动确认。`);
            continue;
          }
          targets.push({
            id: `wsl-cli:${distribution}`,
            kind: "cli",
            environment: "wsl",
            distribution,
            label: `WSL ${distribution} · Codex CLI`,
            detected: !!f.GC_CLI,
            executable: f.GC_CLI || undefined,
            configRoot,
            configExists: f.GC_CONFIG_EXISTS === "1",
            detail: `${f.GC_CLI?.includes("AppData/") ? "当前 PATH 命中 Windows CLI 包装器，不代表 Linux 原生安装。 " : ""}按该发行版检测配置；若注入 Windows exe，则共享 Windows 后台及密钥。自定义 shell 环境请手动确认。`,
          });
          targets.push({
            id: `desktop-wsl:${distribution}`,
            kind: "desktop",
            environment: "wsl",
            distribution,
            label: `Desktop → WSL ${distribution} 后端（手动确认）`,
            detected: !!desktop,
            configRoot,
            configExists: f.GC_CONFIG_EXISTS === "1",
            detail:
              "仅当 Desktop 确实选择此 WSL 后端时注入；Windows exe 互操作接入共享 Windows 后台，不是 Linux 后台。",
          });
        } catch {
          warnings.push(`${distribution}: 发行版不可访问，未修改其配置。`);
        }
      }
    } catch {
      warnings.push("未发现可用的 WSL，Windows 原生接入不依赖 WSL。");
    }
  }
  if (process.env.WSL_DISTRO_NAME) {
    try {
      const profile = execFileSync(windowsTool("cmd.exe"), ["/d", "/c", "echo", "%USERPROFILE%"], {
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      const winHome = execFileSync("wslpath", ["-u", profile], { timeout: 5000 }).toString().trim();
      if (isAbsolute(winHome)) {
        let windowsConfigOverride: string | undefined;
        try {
          windowsConfigOverride =
            execFileSync(
              Bun.which("powershell.exe") ??
                `${windowsTool("cmd.exe").replace(/cmd\.exe$/, "")}WindowsPowerShell/v1.0/powershell.exe`,
              [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Environment]::GetEnvironmentVariable('CODEX_HOME','User')",
              ],
              { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
            )
              .toString()
              .trim() || undefined;
        } catch {
          warnings.push("Windows 用户 CODEX_HOME 无法检测，请手动确认。");
        }
        const winRoot = windowsConfigOverride
          ? execFileSync("wslpath", ["-u", windowsConfigOverride], { timeout: 5000 })
              .toString()
              .trim()
          : join(winHome, ".codex");
        targets.push({
          id: "windows-cli",
          kind: "cli",
          environment: "windows",
          label: "Windows Codex CLI（从 WSL 接入）",
          detected: await exists(join(winHome, "AppData/Roaming/npm/codex.cmd")),
          configRoot: winRoot,
          configExists: await exists(join(winRoot, "config.toml")),
          detail: "Windows 自定义 CODEX_HOME 请在此单独填写其 WSL 映射路径。",
        });
        let windowsDesktop: string | undefined;
        try {
          windowsDesktop =
            execFileSync(
              Bun.which("powershell.exe") ??
                `${windowsTool("cmd.exe").replace(/cmd\.exe$/, "")}WindowsPowerShell/v1.0/powershell.exe`,
              [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-AppxPackage *Codex* | Select-Object -First 1 -ExpandProperty InstallLocation",
              ],
              { timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
            )
              .toString()
              .trim() || undefined;
        } catch {
          warnings.push("Windows Desktop 应用探测不可用，请手动确认目标。");
        }
        targets.push({
          id: "windows-desktop",
          kind: "desktop",
          environment: "windows",
          label: "Windows Codex Desktop（从 WSL 接入）",
          detected: !!windowsDesktop,
          executable: windowsDesktop,
          configRoot: winRoot,
          configExists: await exists(join(winRoot, "config.toml")),
          detail: "需要用户确认 Desktop 存在及实际配置目录。",
        });
      }
    } catch {
      warnings.push("Windows 互操作不可用，保留 WSL 原生接入。");
    }
  }
  for (const target of targets) {
    if (target.environment === "wsl" && process.platform === "win32") continue;
    try {
      const record = JSON.parse(
        await readFile(join(target.configRoot, "gc-bridge-connection.json"), "utf8"),
      ) as { command?: string };
      if (record.command)
        target.connectionStatus = (await exists(record.command))
          ? "已记录接入；入口文件存在，请在对应 Codex 重启后检查 MCP。"
          : "已记录接入，但入口文件已移动或删除，请选择目标后重新注入。";
    } catch {
      /* No connection record is normal before the first injection. */
    }
  }
  for (const target of targets)
    target.sharedConfig = targets.some(
      (other) =>
        other.id !== target.id &&
        other.environment === target.environment &&
        other.distribution === target.distribution &&
        other.configRoot === target.configRoot,
    );
  return { platform: process.platform, architecture: process.arch, targets, warnings };
}
