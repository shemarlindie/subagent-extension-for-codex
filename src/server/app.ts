import { parentPermissionsFromMeta } from "../core/permissions.js";
import express from "express";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { type Control } from "../core/control.js";
import { Auth } from "./auth.js";
import { mcp } from "./mcp.js";
import { callTool, isUserTool } from "./tools.js";
import { type Event } from "../core/model.js";
import { type Events } from "../events/service.js";
import { readFile } from "node:fs/promises";
export function application(
  c: Control,
  auth: Auth,
  origin: string,
  htmlPath: string,
  events?: Events,
  nativeHtmlPath = htmlPath,
) {
  const app = express();
  const allowed = new Set([origin]);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const requestOrigin = req.headers.origin;
    if (requestOrigin && !allowed.has(requestOrigin)) {
      res.status(403).json({ error: "Origin not permitted" });
      return;
    }
    if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Codex-Subagent-Extension, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    if (app.locals.ready === false && req.path !== "/health") {
      res.status(503).json({ error: "Service recovery is still in progress" });
      return;
    }
    next();
  });
  const cookie = (res: express.Response, key: string) =>
    res.setHeader(
      "Set-Cookie",
      `ac_session=${key}; HttpOnly; Path=/; Max-Age=3600; SameSite=${origin.startsWith("https:") ? "None; Secure" : "Strict"}`,
    );
  app.get("/health", (_req, res) =>
    res.status(app.locals.ready === false ? 503 : 200).json({
      service: "codex-subagent-extension",
      status: app.locals.ready === false ? "starting" : "ok",
      providers: c.workers().map((w) => w.provider),
    }),
  );
  app.get(
    [
      "/",
      "/tasks/:task",
      "/tasks/:task/artifacts/:artifact",
      "/workers/:worker",
    ],
    async (_req, res) => {
      res
        .type("html")
        .send(
          (await readFile(htmlPath, "utf8")).replaceAll(
            "__API_ORIGIN__",
            origin,
          ),
        );
    },
  );
  app.post("/api/login", (req, res) => {
    if (!auth.matches(String(req.body.token ?? ""))) {
      res.status(401).json({ error: "Invalid console token" });
      return;
    }
    cookie(res, auth.session(auth.owner));
    res.json({ ok: true });
  });
  app.post("/api/logout", (req, res) => {
    const key = (req.headers.cookie ?? "").match(/ac_session=([^;]+)/)?.[1];
    if (key) auth.sessions.delete(key);
    res.setHeader(
      "Set-Cookie",
      "ac_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict",
    );
    res.json({ ok: true });
  });
  const bearer = (req: express.Request) =>
    auth.matches((req.headers.authorization ?? "").replace(/^Bearer /, ""))
      ? auth.owner
      : undefined;
  const handler = createMcpHandler(() =>
    mcp(c, auth.owner, origin, htmlPath, events, nativeHtmlPath),
  );
  const nodeHandler = toNodeHandler(handler);
  app.locals.closeMcp = () => handler.close();
  app.all("/mcp", async (req, res) => {
    if (!bearer(req)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await nodeHandler(req, res, req.body);
  });
  app.use("/api", (req, res, next) => {
    const owner = bearer(req) ?? auth.ownerFor(req.headers.cookie);
    if (!owner) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.locals.owner = owner;
    if (
      req.method === "POST" &&
      req.headers["x-codex-subagent-extension"] !== "1"
    ) {
      res.status(403).json({ error: "CSRF header required" });
      return;
    }
    next();
  });
  app.post(["/api/tools/:name", "/api/user-tools/:name"], async (req, res) => {
    try {
      // The raw token is an administrator credential. MCP hosts must enforce
      // app-only tool visibility; console users authenticate with a session cookie.
      const userRoute = req.path.startsWith("/api/user-tools/");
      if (userRoute && !isUserTool(String(req.params.name)))
        throw new Error("Unknown user tool");
      const result = await callTool(
        c,
        res.locals.owner,
        String(req.params.name),
        req.body,
        userRoute || (!bearer(req) && auth.ownerFor(req.headers.cookie))
          ? "user"
          : "parent",
        bearer(req) && req.headers["x-codex-parent-permissions"]
          ? parentPermissionsFromMeta({
              "codex-subagent-extension/parent-permissions": JSON.parse(
                String(req.headers["x-codex-parent-permissions"]),
              ),
            })
          : undefined,
      );
      res.json({ result });
    } catch (e) {
      res
        .status(400)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    let cursor = Number(req.headers["last-event-id"] ?? req.query.after ?? 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
    const owner = res.locals.owner;
    const send = (e: Event, eventOwner: string) => {
      if (owner !== eventOwner || e.id <= cursor) return;
      cursor = e.id;
      res.write(`id: ${e.id}\nevent: activity\ndata: ${JSON.stringify(e)}\n\n`);
    }; // Subscribe before replay so events cannot fall through a connection gap.
    c.store.bus.on("event", send);
    let replay;
    do {
      replay = c.store.streamEvents(owner, cursor);
      for (const e of replay) send(e, owner);
    } while (replay.length === 1000);
    const heartbeat = setInterval(() => {
      if (!bearer(req) && !auth.ownerFor(req.headers.cookie)) {
        res.end();
        return;
      }
      res.write(": heartbeat\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      c.store.bus.off("event", send);
    });
  });
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: error.message });
    },
  );
  return app;
}
