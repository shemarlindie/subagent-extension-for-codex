import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { Control } from "../../../src/service/features/tasks/runtime/control.js";
import { Store } from "../../../src/service/features/tasks/storage/store.js";
import { Workspaces } from "../../../src/service/features/workspaces/workspace.js";
import { application } from "../../../src/service/platform/server/app.js";
import { Auth } from "../../../src/service/platform/server/auth.js";
import { waitForListening } from "../../support/helpers.js";

// Node's fetch derives Host from the URL; use HTTP directly to emulate a LAN URL.
function pageAt(base: string, host: string) {
  return new Promise<string>((resolve, reject) => {
    get(base, { headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");

      response.on("data", (chunk: string) => {
        body += chunk;
      });

      response.on("end", () => resolve(body));
      response.on("error", reject);
    }).on("error", reject);
  });
}

test.each([
  { network: false, origin: "http://127.0.0.1:4317" },
  { network: true, origin: "http://127.0.0.1:4317" },
  { network: true, origin: "https://console.example" },
])(
  "LAN console origins are opt-in (network: $network, origin: $origin)",
  async ({ network, origin }) => {
    const dir = await mkdtemp(join(tmpdir(), "ac-network-"));
    const htmlPath = join(dir, "app.html");
    await writeFile(htmlPath, "__API_ORIGIN__");
    const lanOrigin = "http://192.168.1.20:4317";

    const control = new Control(
      new Store(join(dir, "test.sqlite")),
      new Workspaces(join(dir, "worktrees"), []),
      new Map(),
    );

    const app = application(
      control,
      new Auth("test-token"),
      origin,
      htmlPath,
      htmlPath,
      network ? [lanOrigin] : [],
    );

    const server = app.listen(0, "127.0.0.1");

    try {
      await waitForListening(server);
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing listener");
      const base = `http://127.0.0.1:${address.port}`;

      expect(await pageAt(base, "192.168.1.20:4317")).toBe(
        network ? lanOrigin : origin,
      );

      expect(await pageAt(base, "untrusted.example:4317")).toBe(origin);

      const login = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { Origin: lanOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ token: "test-token" }),
      });

      expect(login.status).toBe(network ? 200 : 403);

      if (network) {
        expect(login.headers.get("access-control-allow-origin")).toBe(
          lanOrigin,
        );

        expect(login.headers.get("set-cookie")).toContain("HttpOnly");
        expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
        expect(login.headers.get("set-cookie")).not.toContain("Secure");

        const canonicalLogin = await fetch(`${base}/api/login`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ token: "test-token" }),
        });

        expect(canonicalLogin.status).toBe(200);

        expect(
          canonicalLogin.headers.get("set-cookie")?.includes("Secure"),
        ).toBe(origin.startsWith("https:"));

        const wrongToken = await fetch(`${base}/api/login`, {
          method: "POST",
          headers: { Origin: lanOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ token: "wrong-token" }),
        });

        expect(wrongToken.status).toBe(401);

        const unauthenticated = await fetch(
          `${base}/api/tools/list_agent_tasks`,
          {
            method: "POST",
            headers: { Origin: lanOrigin },
          },
        );

        expect(unauthenticated.status).toBe(401);

        const session = login.headers.get("set-cookie")!.split(";")[0]!;

        const csrf = await fetch(`${base}/api/tools/list_agent_tasks`, {
          method: "POST",
          headers: { Origin: lanOrigin, Cookie: session },
        });

        expect(csrf.status).toBe(403);
        expect(await csrf.json()).toEqual({ error: "CSRF header required" });

        const authenticated = await fetch(
          `${base}/api/tools/list_agent_tasks`,
          {
            method: "POST",
            headers: {
              Origin: lanOrigin,
              Cookie: session,
              "X-Codex-Subagent-Extension": "1",
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );

        expect(authenticated.status).toBe(200);
        expect(await authenticated.json()).toEqual({ result: [] });
      }

      const denied = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { Origin: "http://untrusted.example:4317" },
      });

      expect(denied.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );

      await app.locals.closeMcp();
      await control.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
