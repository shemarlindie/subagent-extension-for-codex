import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInsertSchema, createSelectSchema } from "drizzle-orm/zod";
import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";

import { openDatabase } from "../../platform/database/database.js";
import { tasks } from "../tasks/schema.js";
import { eventOutbox, eventSubscriptions } from "./schema.js";
import {
  filtersSchema,
  identitySchema,
  webhookDeliverySchema,
} from "./subscription-contract.generated.js";
import type {
  Filters,
  Identity,
  WebhookDelivery,
} from "./subscription-contract.js";

const delivery = { mode: "webhook", url: "https://example.com/events" };
const identity = { name: "agent_task.completed", delivery };

test("generated output types match the source contracts", () => {
  expectTypeOf<z.output<typeof filtersSchema>>().toEqualTypeOf<Filters>();

  expectTypeOf<
    z.output<typeof webhookDeliverySchema>
  >().toEqualTypeOf<WebhookDelivery>();

  expectTypeOf<z.output<typeof identitySchema>>().toEqualTypeOf<Identity>();
});

test("missing and undefined arguments default to an empty filter object", () => {
  expect(identitySchema.parse(identity)).toEqual({
    ...identity,
    arguments: {},
  });

  expect(identitySchema.parse({ ...identity, arguments: undefined })).toEqual({
    ...identity,
    arguments: {},
  });

  const argumentsValue = {
    task_id: "task-1",
    conversation_id: "conversation-1",
    provider: "claude",
  };

  expect(
    identitySchema.parse({ ...identity, arguments: argumentsValue }),
  ).toEqual({
    ...identity,
    arguments: argumentsValue,
  });
});

test.each([
  { ...identity, unexpected: true },
  { ...identity, arguments: { unexpected: true } },
  { ...identity, delivery: { ...delivery, unexpected: true } },
  { ...identity, name: "agent_task.started" },
  { ...identity, arguments: null },
  { ...identity, arguments: { task_id: 123 } },
  { ...identity, arguments: { conversation_id: false } },
  { ...identity, arguments: { provider: [] } },
  { ...identity, delivery: { ...delivery, mode: "poll" } },
  { ...identity, delivery: { ...delivery, url: "not a URL" } },
])("rejects malformed subscription contracts: %j", (input) => {
  expect(identitySchema.safeParse(input).success).toBe(false);
});

test.each([
  "https://example.com/events?key=value#fragment",
  "http://localhost:4317/events",
  "mailto:events@example.com",
  "ftp://example.com/events",
  "/relative/path",
  "example.com",
  "",
])("generated URL validation preserves existing behavior for %j", (url) => {
  expect(webhookDeliverySchema.safeParse({ ...delivery, url }).success).toBe(
    z.string().url().safeParse(url).success,
  );
});

test("filter JSON Schema keeps optional string properties and forbids extra fields", () => {
  expect(z.toJSONSchema(filtersSchema)).toEqual({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      task_id: { type: "string" },
      conversation_id: { type: "string" },
      provider: { type: "string" },
    },
    additionalProperties: false,
  });
});

test("generated contracts round-trip through Drizzle schemas and the migrated database", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subscription-contract-"));
  const db = openDatabase(join(dir, "console.sqlite"));

  t.onTestFinished(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const parsed = identitySchema.parse(identity);
  const subscriptionInsert = createInsertSchema(eventSubscriptions);
  const subscriptionSelect = createSelectSchema(eventSubscriptions);

  const subscription = subscriptionInsert.parse({
    id: "subscription-1",
    owner: "conversation-1",
    body: JSON.stringify(parsed),
  });

  db.orm.insert(eventSubscriptions).values(subscription).run();

  const storedSubscription = subscriptionSelect.parse(
    db.orm.select().from(eventSubscriptions).get(),
  );

  expect(identitySchema.parse(JSON.parse(storedSubscription.body))).toEqual(
    parsed,
  );

  expect(
    subscriptionInsert.safeParse({ ...subscription, body: null }).success,
  ).toBe(false);

  db.orm
    .insert(tasks)
    .values({ id: "task-1", owner: "conversation-1", body: "{}" })
    .run();

  const outboxInsert = createInsertSchema(eventOutbox);
  const outboxSelect = createSelectSchema(eventOutbox);

  const outbox = outboxInsert.parse({
    subscription_id: subscription.id,
    event_id: "evt_task-1_1",
    task_id: "task-1",
    body: JSON.stringify({ type: parsed.name, data: { task_id: "task-1" } }),
  });

  expect(outboxSelect.safeParse(outbox).success).toBe(false);

  expect(outboxInsert.safeParse({ ...outbox, attempts: null }).success).toBe(
    false,
  );

  expect(
    outboxInsert.safeParse({ ...outbox, task_id: undefined }).success,
  ).toBe(false);

  db.orm.insert(eventOutbox).values(outbox).run();

  const storedOutbox = outboxSelect.parse(
    db.orm.select().from(eventOutbox).get(),
  );

  expect(storedOutbox).toEqual({
    ...outbox,
    status: "ready",
    attempts: 0,
    next_at: 0,
  });
});
