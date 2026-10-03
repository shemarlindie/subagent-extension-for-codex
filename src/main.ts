import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Store } from "./core/store.js";
import { Control } from "./core/control.js";
import { Workspaces } from "./core/workspace.js";
import { configuredProviders } from "./providers/config.js";
import { Auth } from "./server/auth.js";
import { application } from "./server/app.js";
import { Events } from "./events/service.js";
import { Projects } from "./core/projects.js";
import { dataDirectory, installRoot } from "./service/runtime.js";
import { lease } from "./service/lease.js";
const data = dataDirectory();
mkdirSync(data, { recursive: true, mode: 0o700 });
const release = lease(data);
process.once("exit", release);
const tokenPath = join(data, "admin-token");
let token = process.env.CODEX_SUBAGENT_EXTENSION_TOKEN;
try {
  token ??= readFileSync(tokenPath, "utf8").trim();
} catch {}
if (!token) {
  token = randomBytes(32).toString("base64url");
  writeFileSync(tokenPath, token, { mode: 0o600 });
}
const store = new Store(join(data, "console.sqlite"));
const providers = configuredProviders(store, data);
const concurrency = Number(
  process.env.CODEX_SUBAGENT_EXTENSION_CONCURRENCY ?? 3,
);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
  throw new Error("Concurrency must be between 1 and 20");
const c = new Control(
  store,
  new Workspaces(join(data, "worktrees"), []),
  providers,
  process.cwd(),
  concurrency,
);

c.projects = new Projects(store, c.workspaces);
for (const root of JSON.parse(
  process.env.CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS ?? "[]",
))
  await c.projects.register(resolve(root), "parent");

const port = Number(process.env.PORT ?? 4317);
const origin =
  process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN ?? `http://127.0.0.1:${port}`;
const auth = new Auth(token);
const keyPath = join(data, "events-key");
let eventKey: Buffer;
try {
  eventKey = readFileSync(keyPath);
} catch {
  eventKey = randomBytes(32);
  writeFileSync(keyPath, eventKey, { mode: 0o600, flag: "wx" });
}
const events = new Events(c.store, eventKey);
const app = application(
  c,
  auth,
  origin,
  join(installRoot, "dist/console.html"),
  events,
  join(installRoot, "dist/codex.html"),
);
// Reserve the listener before recovery can change durable tasks or launch workers.
app.locals.ready = false;
const server = app.listen(port, "127.0.0.1");
try {
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
} catch (error) {
  c.store.close();
  throw error;
}
try {
  await c.recover();
  events.start();
  writeFileSync(
    join(data, "service.json"),
    JSON.stringify({ origin, pid: process.pid, version: "0.1.0" }),
    { mode: 0o600 },
  );
  app.locals.ready = true;
} catch (error) {
  server.close();
  await events.close();
  await c.close();
  throw error;
}
console.error(
  `Codex subagent extension service: ${origin}\nLogin token file: ${tokenPath}`,
);
const prune = setInterval(() => auth.prune(), 60000);
let closing: Promise<void> | undefined;
function close() {
  return (closing ??= (async () => {
    app.locals.ready = false;
    clearInterval(prune);
    server.close();
    await app.locals.closeMcp();
    await events.close();
    await c.close();
    process.exit(0);
  })());
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
