import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createDependencyWorkspace, dependencyDirectory } from "./dependency-workspace.ts";

const root = resolve(import.meta.dir, "..");
const dependencies = dependencyDirectory(root);
const action = process.argv[2] ?? "types";
if (action === "types") {
  const workspace = await createDependencyWorkspace(root, dependencies);
  try {
    execFileSync(
      process.execPath,
      [
        join(dependencies, "typescript/bin/tsc"),
        "--noEmit",
        "--project",
        join(workspace.root, "tsconfig.json"),
      ],
      { cwd: workspace.root, stdio: "inherit" },
    );
  } finally {
    await workspace.dispose();
  }
} else if (action === "lint" || action === "format")
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
