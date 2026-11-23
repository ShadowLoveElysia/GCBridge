#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

/** Check reviewed Git-tracked files without displaying matching secret values. */
async function main(): Promise<void> {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  if (!files.length)
    throw new Error("No tracked files; stage an explicit reviewed file list first.");
  const failures: string[] = [];
  for (const file of files) {
    if (
      /(^|\/)(node_modules|\.env(?:\.[^/]+)?)(\/|$)|\.(sqlite|sqlite3|db)(?:-wal|-shm)?$/i.test(
        file,
      ) ||
      /^(?:tmp|tests?|__tests__|coverage)\/|(?:^|\/)test_[^/]*|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
        file,
      )
    ) {
      failures.push(`${file}: private or generated artifact`);
      continue;
    }
    const content = await readFile(file, "utf8");
    if (
      /\bsk-[A-Za-z0-9_-]{32,}\b|\bAIza[A-Za-z0-9_-]{30,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
        content,
      )
    )
      failures.push(`${file}: possible credential`);
    if (
      /(?:api[_-]?key|access[_-]?token|secret[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9_/-]{24,}["']/i.test(
        content,
      )
    )
      failures.push(`${file}: possible credential assignment`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Release check passed for ${files.length} tracked files. No matching credential patterns or private artifacts.`,
    );
}

main().catch(() => {
  console.error("Release check could not inspect the tracked file set.");
  process.exitCode = 1;
});
