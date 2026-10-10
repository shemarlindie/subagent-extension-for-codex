import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

import { type Event } from "../../../../shared/events/types.js";
import {
  approvalModeSchema,
  deliveries,
  providerOptionsSchema,
  roles,
  statuses,
  type Task,
} from "../../../../shared/tasks/model.js";
import {
  checkStored,
  decodeStored,
} from "../../../platform/database/decode.js";
import { events } from "./schema.js";

const eventRowSchema = createSelectSchema(events);

// Stored records are checked for the fields that ownership, scheduling and
// the queue depend on. Other fields, such as provider state, pass through
// unchanged, and nothing is defaulted.

const sender = z.enum(["user", "parent"]);

const message = z.looseObject({
  id: z.string(),
  message: z.string(),
  from: sender,
});

const storedTaskSchema = z.looseObject({
  id: z.string().min(1),
  owner: z.string().min(1),
  title: z.string(),
  description: z.string(),
  provider: z.string(),
  provider_options: providerOptionsSchema.optional(),
  approval_mode: approvalModeSchema.optional(),
  worker_profile: z.enum(roles),
  repository: z.string(),
  revision: z.string(),
  workspace_strategy: z.enum(["worktree", "current_repo"]),
  depends_on: z.array(z.string()),
  context: z.array(z.string()),
  budget: z.looseObject({
    max_runtime_minutes: z.number().nullable(),
    max_cost_usd: z.number().nullable(),
    max_tokens: z.number().optional(),
  }),
  budget_raised_for_turn: z
    .looseObject({
      turn: z.number().int().nonnegative(),
      cost: z.literal(true).optional(),
      runtime: z.literal(true).optional(),
    })
    .optional(),
  created_by: sender,
  status: z.enum(statuses),
  created_at: z.string(),
  updated_at: z.string(),
  pending_input: z
    .looseObject({
      id: z.string(),
      tool: z.string(),
      kind: z.enum(["question", "permission"]),
      input: z.record(z.string(), z.unknown()),
    })
    .optional(),
  instructions: z.array(message),
  instructions_sent: z.number().int().nonnegative(),
  pending_steers: z.array(message),
  queue: z.array(
    message.extend({
      delivery: z.enum(deliveries),
      recorded: z.boolean().optional(),
    }),
  ),
  turn: z.number().int().nonnegative(),
  runtime_ms: z.number().nonnegative(),
});

/** A stored task body, named by its row's id when malformed. */
export function decodeTask(id: string, body: string): Task {
  return decodeStored(storedTaskSchema, body, `task ${id}`) as Task;
}

/** A stored event row, whose data is any JSON object. */
export function decodeEvent(row: typeof events.$inferSelect) {
  const stored = checkStored(eventRowSchema, row, `event ${row.id}`);

  return {
    ...stored,
    data: decodeStored(
      z.record(z.string(), z.unknown()),
      stored.data,
      `event ${stored.id}`,
    ),
  } satisfies Event;
}
