import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import express from "express";

import type { DraftUpdate } from "../../../shared/tasks/conversation/drafts.js";
import { SendRejectedError } from "../../../shared/tasks/conversation/send-errors.js";
import { type Control } from "../../features/tasks/runtime/control.js";
import { preloadPanelHtml, readPanelHtml } from "../panel/panel-html.js";
import { serviceIdentity } from "../service/identity.js";
import { Auth } from "./auth.js";
import { mcp } from "./mcp.js";
import { callTool, isUserTool } from "./tools.js";

/** Host directory forwarded by the stdio proxy; malformed values are ignored. */
function hostDirectoryMeta(header: unknown) {
  if (typeof header !== "string") return undefined;

  try {
    return {
      "codex/sandbox-state-meta": { sandboxCwd: decodeURIComponent(header) },
    };
  } catch {
    return undefined;
  }
}

export function application(
  c: Control,
  auth: Auth,
  origin: string,
  htmlPath: string,
  nativeHtmlPath = htmlPath,
  additionalOrigins: string[] = [],
) {
  preloadPanelHtml(htmlPath);
  preloadPanelHtml(nativeHtmlPath);
  const app = express();
  const allowed = new Set([origin, ...additionalOrigins]);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    // A draining service is about to exit, so clients shouldn't reuse its connections.
    if (app.locals.draining) res.setHeader("Connection", "close");
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
    if (app.locals.stopping && req.path !== "/health") {
      res.status(503).json({ error: "The service is stopping" });

      return;
    }

    if (app.locals.ready === false && req.path !== "/health") {
      res.status(503).json({ error: "Service recovery is still in progress" });

      return;
    }

    next();
  });

  // Use a LAN page's origin only when startup explicitly allowed its address.
  const consoleOrigin = (req: express.Request) => {
    const pageOrigin = `${req.protocol}://${req.get("host")}`;

    return allowed.has(pageOrigin) ? pageOrigin : origin;
  };

  const cookie = (res: express.Response, key: string, sessionOrigin: string) =>
    res.setHeader(
      "Set-Cookie",
      `ac_session=${key}; HttpOnly; Path=/; Max-Age=3600; SameSite=${sessionOrigin.startsWith("https:") ? "None; Secure" : "Strict"}`,
    );

  // The install root stays in service.json: /health may be reachable from the network.
  const { version, apiVersion, launcher } = serviceIdentity();

  app.get("/health", (_req, res) => {
    let status = "ok";

    if (app.locals.stopping) {
      status = "stopping";
    } else if (app.locals.ready === false) {
      status = "starting";
    } else if (app.locals.draining) {
      status = "draining";
    }

    res
      .status(app.locals.ready === false || app.locals.stopping ? 503 : 200)
      .json({
        service: "codex-subagent-extension",
        status,
        version,
        apiVersion,
        launcher,
        providers: c.workers().map((w) => w.provider),
      });
  });

  app.get("/", async (req, res) => {
    res.type("html").send(
      // Inject the template's origin once; preserve the bundled runtime sentinel.
      (await readPanelHtml(htmlPath)).replace("__API_ORIGIN__", () =>
        consoleOrigin(req),
      ),
    );
  });

  app.post("/api/login", (req, res) => {
    if (!auth.matches(String(req.body.token ?? ""))) {
      res.status(401).json({ error: "Invalid console token" });

      return;
    }

    // Origin passed the allowlist above; an HTTP LAN login needs an HTTP cookie
    // even when the canonical console origin is configured for HTTPS.
    cookie(
      res,
      auth.session(auth.owner),
      req.headers.origin ?? consoleOrigin(req),
    );

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
    mcp(c, auth.owner, origin, htmlPath, nativeHtmlPath),
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

  // Only an administrator token may hand the service over. Console sessions can't.
  app.post("/api/service/drain", (req, res) => {
    if (!bearer(req)) {
      res.status(403).json({ error: "Administrator token required" });

      return;
    }

    if (!app.locals.drain) {
      res.status(501).json({ error: "This service cannot drain" });

      return;
    }

    res.status(202).json({ status: "draining", running: app.locals.drain() });
  });

  app.post(["/api/tools/:name", "/api/user-tools/:name"], async (req, res) => {
    try {
      // The raw token is an administrator credential. MCP hosts must enforce
      // app-only tool visibility; console users authenticate with a session cookie.
      const userRoute = req.path.startsWith("/api/user-tools/");

      if (userRoute && !isUserTool(String(req.params.name))) {
        throw new Error("Unknown user tool");
      }

      const result = await callTool(
        c,
        res.locals.owner,
        String(req.params.name),
        req.body,
        userRoute || (!bearer(req) && auth.ownerFor(req.headers.cookie))
          ? "user"
          : "parent",
        bearer(req)
          ? hostDirectoryMeta(req.headers["x-codex-host-directory"])
          : undefined,
      );

      res.json({ result });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
        ...(e instanceof SendRejectedError ? { send_rejected: true } : {}),
      });
    }
  });

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const owner = res.locals.owner;

    // A hint to refresh: the owner's revision now, then after each change.
    const sendChange = (changedOwner?: string) => {
      if (changedOwner === undefined || changedOwner === owner) {
        res.write(`event: change\ndata: ${c.store.revision(owner)}\n\n`);
      }
    };

    const sendDraft = (update: DraftUpdate, updateOwner: string) => {
      if (owner === updateOwner) {
        res.write(`event: delta\ndata: ${JSON.stringify(update)}\n\n`);
      }
    };

    c.store.bus.on("change", sendChange);
    c.store.bus.on("draft", sendDraft);
    sendChange();

    // A client that connects mid-message gets the draft so far.
    for (const draft of c.drafts.forOwner(owner)) {
      sendDraft({ ...draft, offset: 0 }, owner);
    }

    const heartbeat = setInterval(() => {
      if (!bearer(req) && !auth.ownerFor(req.headers.cookie)) {
        res.end();

        return;
      }

      res.write(": heartbeat\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      c.store.bus.off("change", sendChange);
      c.store.bus.off("draft", sendDraft);
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
