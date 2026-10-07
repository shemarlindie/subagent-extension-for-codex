import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Webhook } from "standardwebhooks";
import { test } from "vitest";

import { now, startSchema, type Task } from "../../shared/contracts.js";
import { Store } from "../tasks/store.js";
import { EventProtocolError, Events } from "./service.js";
import {
  callbackUrl,
  publicAddress,
  validSecret,
  type WebhookPost,
} from "./webhook.js";

const secret = "whsec_" + Buffer.alloc(32, 7).toString("base64");

const request = (args: Record<string, string> = {}) => ({
  name: "agent_task.completed",
  arguments: args,
  delivery: {
    mode: "webhook",
    url: "https://receiver.example/mcp-events/callback",
    secret,
  },
  cursor: null,
});

const make = (id = "task-a", owner = "alice"): Task => ({
  ...startSchema.parse({
    description: "Review",
    conversation_id: "chat-a",
  }),
  id,
  title: "Review",
  owner,
  status: "completed",
  created_at: now(),
  updated_at: now(),
  instructions: [],
  attempt: 1,
  runtime_ms: 0,
});

async function setup(status = 200) {
  const dir = await mkdtemp(join(tmpdir(), "ac-events-")),
    db = join(dir, "db.sqlite"),
    store = new Store(db),
    key = randomBytes(32);

  const posts: Array<{
    url: string;
    body: any;
    headers: Record<string, string>;
  }> = [];

  let currentStatus = status;

  const post: WebhookPost = async (url, body, headers) => {
    const json = JSON.parse(body);
    new Webhook(secret).verify(body, headers);
    posts.push({ url, body: json, headers });

    return json.type === "verification"
      ? { status: 200, body: JSON.stringify({ challenge: json.challenge }) }
      : { status: currentStatus, body: "" };
  };

  const events = new Events(store, key, post);
  store.save(make());

  return {
    store,
    key,
    events,
    posts,
    db,
    setStatus: (n: number) => (currentStatus = n),
  };
}

test("webhook validation rejects non-HTTPS, credentials, redirects ports, non-public IPs, and malformed secrets", () => {
  for (const url of [
    "http://receiver.example/cb",
    "https://user:password@receiver.example/cb",
    "https://receiver.example:444/cb",
    "https://receiver.example/cb#fragment",
  ])
    assert.throws(() => callbackUrl(url));
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "192.0.2.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  assert.throws(() => validSecret("not-a-secret"));

  assert.throws(() =>
    validSecret("whsec_" + Buffer.alloc(12).toString("base64")),
  );

  validSecret(secret);
});

test("subscribe identity is canonical, owner-scoped, encrypted and refreshable with bounded expiration", async () => {
  const { store, events } = await setup();

  try {
    const a = (await events.handle("alice", "events/subscribe", {
      ...request({ provider: "claude", conversation_id: "chat-a" }),
      ttlMs: 60000,
    })) as any;

    const b = (await events.handle(
      "alice",
      "events/subscribe",
      request({ conversation_id: "chat-a", provider: "claude" }),
    )) as any;

    assert.equal(a.id, b.id);
    assert.ok(a.refreshBefore);
    assert.equal(a.cursor, null);

    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM event_subscriptions").get()!
        .n,
      1,
    );

    const body = String(
      store.db.prepare("SELECT body FROM event_subscriptions").get()!.body,
    );

    assert.ok(!body.includes(secret));

    await assert.rejects(
      events.handle("bob", "events/subscribe", request({ task_id: "task-a" })),
      /unauthorized/,
    );

    const finite = (await events.handle("alice", "events/subscribe", {
      ...request(),
      ttlMs: null,
    })) as any;

    assert.ok(finite.refreshBefore);
    assert.ok(new Date(finite.refreshBefore).getTime() < Date.now() + 86401000);
  } finally {
    await events.close();
    store.close();
  }
});

test("failed callback verification never creates a subscription or exposes the supplied secret", async () => {
  const { store, key } = await setup();

  const events = new Events(store, key, async () => ({
    status: 200,
    body: JSON.stringify({ challenge: "wrong" }),
  }));

  try {
    await assert.rejects(
      events.handle("alice", "events/subscribe", request()),
      (e: unknown) =>
        e instanceof EventProtocolError &&
        e.code === -32015 &&
        e.reason === "challenge_failed" &&
        !e.message.includes(secret),
    );

    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM event_subscriptions").get()!
        .n,
      0,
    );
  } finally {
    await events.close();
    store.close();
  }
});

test("completion events are compact, filtered, signed, idempotent and durable across restart", async () => {
  const { store, events, key, posts, db } = await setup();

  await events.handle(
    "alice",
    "events/subscribe",
    request({ task_id: "task-a" }),
  );

  const t = make();

  t.result = {
    summary: "Review complete",
    findings: [],
    evidence: [],
    changes: [],
    tests: [],
    recommendations: [],
  };

  store.save(t);

  const event = store.event(t, "task.completed", {
    summary: "Review complete",
  });

  store.save(make("task-other"));
  store.event(make("task-other"), "task.completed", { summary: "Filtered" });
  events.capture();
  events.capture();

  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM event_outbox").get()!.n,
    1,
  );

  await events.close();
  store.close();
  const restored = new Store(db);

  const restarted = new Events(restored, key, async (url, body, headers) => {
    new Webhook(secret).verify(body, headers);
    posts.push({ url, body: JSON.parse(body), headers });

    return { status: 200, body: "" };
  });

  await restarted.flush();
  await restarted.flush();
  const delivered = posts.filter((p) => !p.body.type);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].body.eventId, `evt_task-a_${event.id}`);
  assert.equal(delivered[0].body.name, "agent_task.completed");
  assert.equal(delivered[0].body.data.result_available, true);
  assert.equal(delivered[0].body.cursor, null);
  assert.ok(!JSON.stringify(delivered[0].body).includes("findings"));
  assert.equal(delivered[0].headers["webhook-id"], delivered[0].body.eventId);
  await restarted.close();
  restored.close();
});

test("transient failures retry with stable event IDs; permanent failures stop delivery", async () => {
  const { store, events, posts, setStatus } = await setup(503);

  try {
    await events.handle("alice", "events/subscribe", request());
    store.event(make(), "task.completed", {});
    events.capture();
    await events.flush();
    const first = store.db.prepare("SELECT * FROM event_outbox").get()!;
    assert.equal(first.attempts, 1);
    assert.ok(Number(first.next_at) > Date.now());
    store.db.exec("UPDATE event_outbox SET next_at=0");
    setStatus(200);
    await events.flush();
    assert.equal(posts.filter((p) => !p.body.type).length, 2);
    assert.equal(posts[1].body.eventId, posts[2].body.eventId);
    store.event(make(), "task.completed", {});
    events.capture();
    setStatus(410);
    await events.flush();

    const sub = JSON.parse(
      String(
        store.db.prepare("SELECT body FROM event_subscriptions").get()!.body,
      ),
    );

    assert.equal(sub.active, false);

    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS n FROM event_outbox WHERE status='ready'")
        .get()!.n,
      0,
    );
  } finally {
    await events.close();
    store.close();
  }
});

test("unsubscribe is idempotent and revoked ownership prevents queued delivery", async () => {
  const { store, events, posts } = await setup();

  try {
    const params = request();
    await events.handle("alice", "events/subscribe", params);
    store.event(make(), "task.completed", {});
    events.capture();

    store.db
      .prepare("UPDATE tasks SET owner=? WHERE id=?")
      .run("bob", "task-a");

    await events.flush();
    assert.equal(posts.filter((p) => !p.body.type).length, 0);
    const { secret: _secret, ...delivery } = params.delivery;

    await events.handle("alice", "events/unsubscribe", {
      name: params.name,
      arguments: params.arguments,
      delivery,
    });

    await events.handle("alice", "events/unsubscribe", {
      name: params.name,
      arguments: params.arguments,
      delivery,
    });

    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM event_subscriptions").get()!
        .n,
      0,
    );
  } finally {
    await events.close();
    store.close();
  }
});

test("input-required and failure catalogs match persisted event envelopes without carrying high-volume logs", async () => {
  const { store, events, posts } = await setup();

  try {
    const catalog = (await events.handle("alice", "events/list", {})) as any;
    assert.equal(catalog.events.length, 3);
    for (const name of ["agent_task.input_required", "agent_task.failed"])
      await events.handle("alice", "events/subscribe", { ...request(), name });
    store.event(make(), "agent.message", { text: "do not webhook logs" });

    store.event(make(), "agent.input_required", {
      request: { tool: "Bash", input: { command: "large" } },
    });

    store.event(make(), "task.failed", { error: "Runtime budget exhausted" });
    events.capture();
    await events.flush();
    const delivered = posts.filter((p) => !p.body.type);

    assert.deepEqual(delivered.map((p) => p.body.name).sort(), [
      "agent_task.failed",
      "agent_task.input_required",
    ]);

    assert.ok(!JSON.stringify(delivered).includes("large"));
  } finally {
    await events.close();
    store.close();
  }
});

test("callback transport revalidates DNS, pins the approved address and retains TLS hostname without following redirects", async () => {
  const { createWebhookPost } = await import("./webhook.js");
  const { EventEmitter } = await import("node:events");
  let lookups = 0,
    connections = 0,
    pinned: any;
  let dns = [{ address: "8.8.8.8", family: 4 }];

  const post = createWebhookPost(
    (async () => {
      lookups++;

      return dns;
    }) as any,
    ((_url: any, options: any, onResponse: any) => {
      connections++;
      assert.equal(options.servername, "receiver.example");

      options.lookup(
        "receiver.example",
        { all: true },
        (_error: any, addresses: any) => (pinned = addresses),
      );

      const req = new EventEmitter() as any;

      req.end = () => {
        const response = new EventEmitter() as any;
        response.statusCode = 302;
        response.setEncoding = () => {};
        onResponse(response);

        queueMicrotask(() => {
          response.emit("end");
          req.emit("close");
        });
      };

      req.destroy = (e: Error) => {
        req.emit("error", e);
        req.emit("close");
      };

      return req;
    }) as any,
  );

  assert.equal(
    (await post("https://receiver.example/callback", "{}", {})).status,
    302,
  );

  assert.equal(connections, 1);
  assert.deepEqual(pinned, [{ address: "8.8.8.8", family: 4 }]);
  dns = [{ address: "127.0.0.1", family: 4 }];

  await assert.rejects(
    post("https://receiver.example/callback", "{}", {}),
    /not public/,
  );

  assert.equal(lookups, 2);
  assert.equal(connections, 1);
});

test("secret rotation signs with both keys during the bounded transition window and refresh preserves rotation", async () => {
  const { store, key } = await setup();
  let current = secret;
  const posts: any[] = [];
  const other = "whsec_" + Buffer.alloc(32, 3).toString("base64");

  const events = new Events(store, key, async (_url, body, headers) => {
    const json = JSON.parse(body);
    new Webhook(current).verify(body, headers);
    posts.push({ json, headers, body });

    return { status: 200, body: JSON.stringify({ challenge: json.challenge }) };
  });

  try {
    await events.handle("alice", "events/subscribe", request());
    current = other;

    const updated = {
      ...request(),
      delivery: { ...request().delivery, secret: other },
    };

    await events.handle("alice", "events/subscribe", updated);
    await events.handle("alice", "events/subscribe", updated);
    assert.equal(posts.filter((p) => p.json.type).length, 2);
    store.event(make(), "task.completed", {});
    events.capture();
    await events.flush();
    const delivered = posts.find((p) => !p.json.type);
    new Webhook(secret).verify(delivered.body, delivered.headers);
    new Webhook(other).verify(delivered.body, delivered.headers);
  } finally {
    await events.close();
    store.close();
  }
});

test("expired subscriptions and subscriptions recreated after unsubscribe never send old queued work", async () => {
  const { store, events, posts } = await setup();

  try {
    await events.handle("alice", "events/subscribe", request());
    store.event(make(), "task.completed", {});
    events.capture();
    const row = store.db.prepare("SELECT body FROM event_subscriptions").get()!;
    const s = JSON.parse(String(row.body));
    s.expires = 0;

    store.db
      .prepare("UPDATE event_subscriptions SET body=?")
      .run(JSON.stringify(s));

    await events.flush();
    assert.equal(posts.filter((p) => !p.body.type).length, 0);
    const params = request();
    const { secret: _secret, ...delivery } = params.delivery;

    await events.handle("alice", "events/unsubscribe", {
      name: params.name,
      arguments: {},
      delivery,
    });

    await events.handle("alice", "events/subscribe", request());
    await events.flush();
    assert.equal(posts.filter((p) => !p.body.type).length, 0);
  } finally {
    await events.close();
    store.close();
  }
});
