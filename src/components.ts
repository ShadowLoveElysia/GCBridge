import { execFileSync } from "node:child_process";
import { Agent } from "@oh-my-pi/pi-agent-core";
import * as native from "@oh-my-pi/pi-natives";
import { compiled } from "./paths.ts";

export async function componentStatus() {
  let translated = false;
  if (process.platform === "darwin") {
    try {
      translated =
        execFileSync("sysctl", ["-in", "sysctl.proc_translated"], {
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim() === "1";
    } catch {
      /* Native macOS processes need not expose this key. */
    }
  }
  return {
    ready: typeof Agent === "function" && typeof native.FileLock === "function",
    ohMyPi: {
      version: "19.1.1",
      mode: "headless SDK",
      bundled: compiled,
      nativeVersion: "validated by OMP loader",
    },
    platform: process.platform,
    architecture: process.arch,
    rosettaTranslated: translated,
    architectureNote: translated
      ? "Running Intel build under Rosetta; use the arm64 build for native Apple Silicon performance."
      : undefined,
    bun: Bun.version,
    nodeRequired: false,
    globalOhMyPiRequired: false,
  };
}
