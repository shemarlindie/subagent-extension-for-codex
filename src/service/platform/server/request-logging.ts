import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { logEvent, withLogContext } from "../logging/logger.js";

/** Fixed route labels keep credentials, query strings and arbitrary URL segments out of logs. */
function route(req: Request) {
  if (
    [
      "/",
      "/health",
      "/mcp",
      "/api/login",
      "/api/logout",
      "/api/events",
      "/api/service/drain",
    ].includes(req.path)
  ) {
    return req.path;
  }

  if (/^\/api\/(?:user-)?tools\/[^/]+$/.test(req.path)) {
    return "/api/tools/:name";
  }

  return "unknown";
}

export function requestLogging(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = randomUUID();
  const started = performance.now();
  const routeName = route(req);
  res.setHeader("X-Request-Id", requestId);

  withLogContext({ request_id: requestId, route: routeName }, () => {
    let finished = false;

    const complete = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      const stream = routeName === "/api/events" || routeName === "/mcp";

      const level =
        res.statusCode >= 500 || (aborted && !stream) ? "warn" : "info";

      logEvent(
        routeName === "/health" ||
          res.statusCode === 401 ||
          res.statusCode === 403 ||
          (routeName === "/api/tools/:name" && res.statusCode < 400)
          ? "debug"
          : level,
        "http.request",
        {
          request_id: requestId,
          route: routeName,
          method: req.method,
          status: res.statusCode,
          aborted,
          duration_ms: performance.now() - started,
        },
      );
    };

    res.once("finish", () => complete(false));
    res.once("close", () => complete(!res.writableFinished));
    next();
  });
}

export function authRejectionLogger() {
  let windowStarted = Date.now();
  let count = 0;
  let suppressed = 0;

  return (req: Request, reason?: string) => {
    if (Date.now() - windowStarted >= 60_000) {
      if (suppressed) {
        logEvent("warn", "auth.rejections_suppressed", { count: suppressed });
      }

      windowStarted = Date.now();
      count = 0;
      suppressed = 0;
    }

    if (++count > 20) {
      suppressed++;

      return;
    }

    let classification = reason;

    if (!classification) {
      classification = "missing_credentials";
      if (req.headers.cookie) classification = "invalid_or_expired_session";
      if (req.headers.authorization) classification = "invalid_bearer";
    }

    logEvent("warn", "auth.rejected", { reason: classification });
  };
}
