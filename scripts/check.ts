import { execFileSync } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dependencies =
  process.env.NODE_PATH?.split(delimiter).find(Boolean) ??
  dirname(dirname(Bun.resolveSync("typescript/package.json", root)));
const action = process.argv[2] ?? "types";
if (action === "types")
  execFileSync(
    process.execPath,
    [
      join(dependencies, "typescript/bin/tsc"),
      "--noEmit",
      "--project",
      join(root, "tsconfig.json"),
      "--baseUrl",
      dependencies,
      "--typeRoots",
      join(dependencies, "@types"),
    ],
    { cwd: root, stdio: "inherit" },
  );
else if (action === "lint" || action === "format")
  execFileSync(
    process.execPath,
    [
      join(dependencies, "@biomejs/biome/bin/biome"),
      action === "lint" ? "check" : "format",
      ...(action === "format" ? ["--write"] : []),
      "src",
      "scripts",
    ],
    { cwd: root, stdio: "inherit" },
  );
else throw new Error("Expected types, lint or format.");
