import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assetText } from "./assets.ts";
import { tokenMatches } from "./daemon.ts";
import { publicError } from "./errors.ts";
import { Manager } from "./manager.ts";
import { ensureSettings, safeSettings, saveSettings } from "./settings.ts";

export async function startGui(path?: string, openBrowser = true) {
  const configPath = await ensureSettings(path);
  const manager = new Manager(configPath),
    token = randomUUID() + randomUUID();
  const assets = new Map([
    ["/", "index.html"],
    ["/app.js", "app.js"],
    ["/workspace.js", "workspace.js"],
    ["/style.css", "style.css"],
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 12_000_000,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url),
        origin = `http://127.0.0.1:${server.port}`;
      const headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      };
      if (url.hostname !== "127.0.0.1") return new Response(null, { status: 403 });
      if (!url.pathname.startsWith("/api/")) {
        const asset = assets.get(url.pathname);
        if (!asset || request.method !== "GET") return new Response(null, { status: 404, headers });
        const type = asset.endsWith(".js")
          ? "text/javascript"
          : asset.endsWith(".css")
            ? "text/css"
            : "text/html";
        return new Response(await assetText(`ui/${asset}`), {
          headers: { ...headers, "Content-Type": `${type}; charset=utf-8` },
        });
      }
      if (
        !tokenMatches(request.headers.get("authorization"), token) ||
        (request.headers.get("origin") && request.headers.get("origin") !== origin)
      )
        return new Response(null, { status: 403, headers });
      try {
        let result: unknown;
        if (request.method === "GET" && url.pathname === "/api/settings")
          result = await safeSettings(configPath);
        else if (request.method === "GET" && url.pathname === "/api/components") {
          const { componentStatus } = await import("./components.ts");
          result = await componentStatus();
        } else if (request.method === "GET" && url.pathname === "/api/status")
          result = await manager.status();
        else if (request.method === "POST" && url.pathname === "/api/settings")
          result = await saveSettings(configPath, await request.json());
        else if (request.method === "POST" && url.pathname === "/api/action")
          result = await manager.dispatch(await request.json(), request.signal);
        else if (request.method === "GET" && url.pathname === "/api/detect-codex") {
          const { detectCodex } = await import("./codex-detection.ts");
          result = await detectCodex();
        } else if (request.method === "POST" && url.pathname === "/api/install") {
          const { installCodex } = await import("./install.ts");
          const selection: unknown = await request.json();
          if (
            !selection ||
            typeof selection !== "object" ||
            !("targetId" in selection) ||
            typeof selection.targetId !== "string" ||
            ("configRoot" in selection && typeof selection.configRoot !== "string")
          )
            throw new Error("Select a Codex target");
          result = await installCodex({
            targetId: selection.targetId,
            configRoot: "configRoot" in selection ? (selection.configRoot as string) : undefined,
          });
        } else return new Response(null, { status: 404, headers });
        return Response.json({ result }, { headers });
      } catch (error) {
        return Response.json({ error: publicError(error) }, { status: 400, headers });
      }
    },
  });
  const url = `http://127.0.0.1:${server.port}/#${token}`;
  // The capability fragment stays in browser memory; it is never sent in URLs to the server.
  if (openBrowser && process.env.GC_BRIDGE_NO_OPEN !== "1") {
    const child =
      process.platform === "win32"
        ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { stdio: "ignore" })
        : process.env.WSL_DISTRO_NAME
          ? spawn("/mnt/c/Windows/System32/rundll32.exe", ["url.dll,FileProtocolHandler", url], {
              stdio: "ignore",
            })
          : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });
    child.on("error", () => {
      console.error(
        "Browser could not be opened automatically; run the launcher from an interactive desktop.",
      );
    });
    child.unref();
  }
  console.log(
    `GC_Bridge control panel ready on loopback port ${server.port}. Background director remains off until Start.`,
  );
  return { server, url, configPath };
}
