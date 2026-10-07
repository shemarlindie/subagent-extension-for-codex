import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import { type Event } from "../../shared/contracts.js";
import { REPLY_EXCERPT_CHARS, replyExcerpt } from "../tasks/reply.js";
import type { Store } from "../tasks/store.js";
import {
  callbackUrl,
  signedHeaders,
  validSecret,
  type WebhookPost,
  webhookPost,
} from "./webhook.js";

const names = [
  "agent_task.completed",
  "agent_task.failed",
  "agent_task.input_required",
] as const;

const basePayload = {
  task_id: { type: "string" },
  provider: { type: "string" },
  worker_profile: { type: "string" },
  turn: { type: "integer" },
};

/** A completed turn carries its reply; the others say what happened. */
function payloadSchema(name: (typeof names)[number]) {
  const detail = name === "agent_task.completed" ? "reply" : "summary";

  return {
    type: "object",
    properties: { ...basePayload, [detail]: { type: "string" } },
    required: [...Object.keys(basePayload), detail],
    additionalProperties: false,
  };
}

const filters = z
  .object({
    task_id: z.string().optional(),
    conversation_id: z.string().optional(),
    provider: z.string().optional(),
  })
  .strict();

const identity = z
  .object({
    name: z.enum(names),
    arguments: filters.default({}),
    delivery: z
      .object({ mode: z.literal("webhook"), url: z.string().url() })
      .strict(),
  })
  .strict();

const subscribe = identity.extend({
  delivery: identity.shape.delivery.extend({ secret: z.string() }),
  cursor: z.null().optional(),
  ttlMs: z.number().int().positive().nullable().optional(),
});

type Subscription = {
  id: string;
  owner: string;
  name: string;
  arguments: z.infer<typeof filters>;
  url: string;
  secret: string;
  previous?: string;
  rotation_until?: number;
  expires: number;
  after_event: number;
  active: boolean;
};

export class EventProtocolError extends Error {
  constructor(
    public code: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );

  return JSON.stringify(value);
}

export class Events {
  private stopped = false;
  private verified = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;
  private listener = () => {
    this.capture();
    void this.flush().catch(() => {});
  };

  constructor(
    private store: Store,
    private key: Buffer,
    private post: WebhookPost = webhookPost,
  ) {
    if (key.length !== 32)
      throw new Error("Events encryption key must be 32 bytes");

    store.db
      .exec(`CREATE TABLE IF NOT EXISTS event_subscriptions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS event_outbox(subscription_id TEXT NOT NULL,event_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ready',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(subscription_id,event_id));
 CREATE TABLE IF NOT EXISTS event_checkpoint(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL);
 INSERT OR IGNORE INTO event_checkpoint VALUES(1,0);`);
  }

  start() {
    this.stopped = false;
    this.capture();
    this.store.bus.on("event", this.listener);

    this.timer = setInterval(() => {
      this.capture();
      void this.flush().catch(() => {});
    }, 1000);

    void this.flush().catch(() => {});
  }

  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    this.store.bus.off("event", this.listener);
    await this.flushing;
  }

  private seal(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);

    const content = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64");
  }

  private unseal(value: string) {
    const b = Buffer.from(value, "base64"),
      decipher = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));

    decipher.setAuthTag(b.subarray(12, 28));

    return Buffer.concat([
      decipher.update(b.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }

  private save(s: Subscription) {
    this.store.db
      .prepare(
        "INSERT INTO event_subscriptions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(s.id, s.owner, JSON.stringify(s));
  }

  private id(owner: string, request: z.infer<typeof identity>) {
    return (
      "sub_" +
      createHash("sha256")
        .update(
          canonical({
            owner,
            name: request.name,
            arguments: request.arguments,
            url: request.delivery.url,
          }),
        )
        .digest("hex")
    );
  }

  private visible(owner: string, args: z.infer<typeof filters>) {
    if (args.task_id) this.store.get(args.task_id, owner);
  }

  catalog() {
    return {
      events: names.map((name) => ({
        name,
        description: {
          "agent_task.completed":
            "A delegated task finished its turns and is idle, with nothing queued; read its full reply with get_agent_messages and the turn's changes with get_agent_changes(scope: turn).",
          "agent_task.failed": "A delegated task's turn failed.",
          "agent_task.input_required":
            "A delegated task needs user input or permission.",
        }[name],
        delivery: ["webhook"],
        inputSchema: z.toJSONSchema(filters),
        payloadSchema: payloadSchema(name),
      })),
    };
  }

  async handle(owner: string, method: string, params: unknown) {
    try {
      if (method === "events/list") {
        z.object({ cursor: z.null().optional() })
          .strict()
          .parse(params ?? {});

        return this.catalog();
      }

      if (method === "events/unsubscribe") {
        const r = identity.parse(params);
        const id = this.id(owner, r);

        this.store.db
          .prepare("DELETE FROM event_subscriptions WHERE id=? AND owner=?")
          .run(id, owner);

        this.store.db
          .prepare(
            "UPDATE event_outbox SET status='dead' WHERE subscription_id=?",
          )
          .run(id);

        return {};
      }

      if (method !== "events/subscribe")
        throw new EventProtocolError(-32601, "Unknown event method");
      const r = subscribe.parse(params);
      this.visible(owner, r.arguments);
      callbackUrl(r.delivery.url);
      validSecret(r.delivery.secret);
      const id = this.id(owner, r);
      const challenge = randomBytes(32).toString("base64url");

      const verificationId =
        "msg_verification_" + randomBytes(16).toString("hex");

      const body = JSON.stringify({ type: "verification", challenge });

      const verificationKey = createHash("sha256")
        .update(
          canonical({ owner, url: r.delivery.url, secret: r.delivery.secret }),
        )
        .digest("hex");

      if ((this.verified.get(verificationKey) ?? 0) <= Date.now())
        try {
          const reply = await this.post(
            r.delivery.url,
            body,
            signedHeaders(verificationId, body, r.delivery.secret, id),
          );

          const returned = Buffer.from(
              String(JSON.parse(reply.body).challenge ?? ""),
            ),
            expected = Buffer.from(challenge);

          if (
            reply.status < 200 ||
            reply.status >= 300 ||
            returned.length !== expected.length ||
            !timingSafeEqual(returned, expected)
          )
            throw new Error("Challenge failed");
          for (const [key, until] of this.verified)
            if (until <= Date.now()) this.verified.delete(key);
          if (this.verified.size >= 1000)
            this.verified.delete(this.verified.keys().next().value!);
          this.verified.set(verificationKey, Date.now() + 300000);
        } catch (error) {
          throw new EventProtocolError(
            -32015,
            "Callback verification failed",
            error instanceof Error && error.message.includes("timed out")
              ? "timeout"
              : "challenge_failed",
          );
        }

      this.visible(owner, r.arguments);

      const row = this.store.db
        .prepare("SELECT body FROM event_subscriptions WHERE id=? AND owner=?")
        .get(id, owner);

      const old: Subscription | undefined = row
        ? JSON.parse(String(row.body))
        : undefined;

      const expires = Date.now() + Math.min(r.ttlMs ?? 86400000, 7 * 86400000);

      const s: Subscription = {
        id,
        owner,
        name: r.name,
        arguments: r.arguments,
        url: r.delivery.url,
        secret: this.seal(r.delivery.secret),
        expires,
        after_event:
          old?.after_event ??
          Number(
            this.store.db
              .prepare("SELECT COALESCE(MAX(id),0) AS id FROM events")
              .get()!.id,
          ),
        active: true,
      };

      if (old && this.unseal(old.secret) !== r.delivery.secret) {
        s.previous = old.secret;
        s.rotation_until = Date.now() + 300000;
      } else if (old?.previous && old.rotation_until! > Date.now()) {
        s.previous = old.previous;
        s.rotation_until = old.rotation_until;
      }

      this.save(s);

      return {
        id,
        refreshBefore: new Date(expires).toISOString(),
        cursor: null,
        truncated: false,
      };
    } catch (e) {
      if (e instanceof EventProtocolError) throw e;
      throw new EventProtocolError(
        -32602,
        "Invalid or unauthorized event request",
      );
    }
  }

  capture() {
    let cursor = Number(
      this.store.db
        .prepare("SELECT cursor FROM event_checkpoint WHERE id=1")
        .get()!.cursor,
    );

    const rows = this.store.db
      .prepare("SELECT * FROM events WHERE id>? ORDER BY id LIMIT 1000")
      .all(cursor);

    const subscriptions = this.store.db
      .prepare("SELECT body FROM event_subscriptions")
      .all()
      .map((r) => JSON.parse(String(r.body)) as Subscription);

    for (const row of rows) {
      const e = {
        ...row,
        data: JSON.parse(String(row.data)),
      } as unknown as Event;

      const name = (
        {
          "task.completed": "agent_task.completed",
          "task.failed": "agent_task.failed",
          "agent.input_required": "agent_task.input_required",
        } as Record<string, string>
      )[e.type];

      this.store.db.exec("BEGIN IMMEDIATE");

      try {
        if (name)
          for (const s of subscriptions) {
            if (
              !s.active ||
              s.expires <= Date.now() ||
              s.name !== name ||
              e.id <= s.after_event
            )
              continue;
            let t;

            try {
              t = this.store.get(e.task_id, s.owner);
            } catch {
              continue;
            }

            if (
              (s.arguments.task_id && s.arguments.task_id !== t.id) ||
              (s.arguments.conversation_id &&
                s.arguments.conversation_id !== t.conversation_id) ||
              (s.arguments.provider && s.arguments.provider !== t.provider)
            )
              continue;

            const envelope = {
              eventId: `evt_${t.id}_${e.id}`,
              name,
              timestamp: e.timestamp,
              data: {
                task_id: t.id,
                provider: t.provider,
                worker_profile: t.worker_profile,
                turn: t.turn,
                ...(name === "agent_task.completed"
                  ? { reply: replyExcerpt(String(e.data.reply ?? "")) }
                  : {
                      summary: String(
                        e.data.error ??
                          (name === "agent_task.input_required"
                            ? "User input required"
                            : name),
                      ).slice(0, REPLY_EXCERPT_CHARS),
                    }),
              },
              cursor: null,
            };

            this.store.db
              .prepare(
                "INSERT OR IGNORE INTO event_outbox(subscription_id,event_id,body) VALUES(?,?,?)",
              )
              .run(s.id, envelope.eventId, JSON.stringify(envelope));
          }

        this.store.db
          .prepare("UPDATE event_checkpoint SET cursor=? WHERE id=1")
          .run(e.id);

        this.store.db.exec("COMMIT");
        cursor = e.id;
      } catch (error) {
        this.store.db.exec("ROLLBACK");
        throw error;
      }
    }

    if (rows.length === 1000) this.capture();
  }

  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.deliver();

    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }

  private async deliver() {
    const rows = this.store.db
      .prepare(
        "SELECT * FROM event_outbox WHERE status='ready' AND next_at<=? ORDER BY next_at LIMIT 100",
      )
      .all(Date.now());

    for (const row of rows) {
      if (this.stopped) break;

      const subscription = this.store.db
        .prepare("SELECT body FROM event_subscriptions WHERE id=?")
        .get(row.subscription_id);

      const s: Subscription | undefined = subscription
        ? JSON.parse(String(subscription.body))
        : undefined;

      const envelope = JSON.parse(String(row.body));
      let permitted = false;

      try {
        if (s) this.store.get(envelope.data.task_id, s.owner);
        permitted = !!s && s.active && s.expires > Date.now();
      } catch {}

      if (!permitted) {
        this.finish(row, "dead");
        continue;
      }

      const sub = s!;
      const attempts = Number(row.attempts) + 1;
      let status = 0;

      try {
        const headers = signedHeaders(
          String(row.event_id),
          String(row.body),
          this.unseal(sub.secret),
          sub.id,
          sub.previous && sub.rotation_until! > Date.now()
            ? this.unseal(sub.previous)
            : undefined,
        );

        status = (await this.post(sub.url, String(row.body), headers)).status;
      } catch {}

      if (status >= 200 && status < 300) this.finish(row, "delivered");
      else if (status === 410) {
        sub.active = false;
        this.save(sub);
        this.finish(row, "dead");
      } else if (
        status === 413 ||
        (status >= 300 && status < 500 && status !== 429) ||
        attempts >= 8
      )
        this.finish(row, "dead");
      else
        this.store.db
          .prepare(
            "UPDATE event_outbox SET attempts=?,next_at=? WHERE subscription_id=? AND event_id=?",
          )
          .run(
            attempts,
            Date.now() + Math.min(1000 * 2 ** (attempts - 1), 3600000),
            row.subscription_id,
            row.event_id,
          );
    }
  }

  private finish(row: Record<string, unknown>, status: string) {
    this.store.db
      .prepare(
        "UPDATE event_outbox SET status=? WHERE subscription_id=? AND event_id=?",
      )
      .run(status, row.subscription_id as string, row.event_id as string);
  }
}
