import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Store } from "./store.js";
import { Control } from "./control.js";
import { Workspaces } from "./workspace.js";
import { configuredProviders } from "./provider-config.js";
import { Auth } from "./auth.js";
import { application } from "./app.js";
import { Events } from "./events/service.js";
import { lease } from "./lease.js";
const repository = resolve(
  process.env.CODEX_SUBAGENT_EXTENSION_REPOSITORY ?? process.cwd(),
);
const data = resolve(
  process.env.CODEX_SUBAGENT_EXTENSION_DATA ?? ".codex-subagent-extension",
);
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
  new Workspaces(join(data, "worktrees"), [repository]),
  providers,
  repository,
  concurrency,
);

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
  resolve("dist/console.html"),
  events,
  resolve("dist/codex.html"),
);
events.start();
await c.recover();
const server = app.listen(port, "127.0.0.1", () => {
  console.error(
    `Codex subagent extension service: ${origin}\nLogin token file: ${tokenPath}`,
  );
});
server.on("error", (error) => {
  console.error(error.message);
  c.store.close();
  process.exit(1);
});
const prune = setInterval(() => auth.prune(), 60000); // Keep lifecycle ownership centralized in this service.
async function close() {
  clearInterval(prune);
  server.close();
  await app.locals.closeMcp();
  await events.close();
  await c.close();
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
