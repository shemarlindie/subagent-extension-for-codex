import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  max,
  sql,
} from "drizzle-orm";

import type { EventPayloadMap } from "../../../../shared/events/event-contract.js";
import type {
  EventType,
  HasNoPayload,
} from "../../../../shared/events/event-types.js";
import type { Event } from "../../../../shared/events/types.js";
import type { ReadState } from "../../../../shared/tasks/conversation/unread.js";
import { type Task } from "../../../../shared/tasks/model.js";
import { now } from "../../../../shared/time.js";
import {
  type Database,
  openDatabase,
} from "../../../platform/database/database.js";
import { chatEvents } from "./chat-events.js";
import {
  eventColumns,
  insertEvent,
  readOriginalResponse,
} from "./event-records.js";
import { EventStorageMetrics } from "./event-storage-metrics.js";
import { MessageStore } from "./message-store.js";
import { publishListeners } from "./publish-listeners.js";
import { ReadMetrics } from "./read-metrics.js";
import { events, taskRead, tasks } from "./schema.js";
import { decodeEvent } from "./stored.js";
import {
  latestEvents,
  readCompletedFlags,
  readStates,
  readTasks,
  type TaskFilters,
  taskFilters,
} from "./task-rows.js";

const newest = desc(tasks.created_at);

/** The 1,000-event page that event reads return at most. */
const PAGE = 1000;

/**
 * Task and event persistence, and the bus that announces committed changes:
 * `event` for each event, and `change` with the owner whose tasks changed,
 * or no owner when the shared project list did.
 * Methods taking an owner are the public, owner-checked reads; the others
 * are internal reads for code that already holds the task.
 */
export class Store {
  /** The shared connection, which other features' storage also uses. */
  readonly database: Database;
  readonly messages: MessageStore;
  readonly reads = new ReadMetrics();
  private readonly eventStorage = new EventStorageMetrics();

  /** The tasks saved in the open transaction, with the `updated_at` to restore on rollback. */
  private saved?: [Task, string][];
  /** The owners whose tasks the open transaction changed. */
  private changed?: Set<string>;
  /** Distinguishes this process's revisions from a restarted service's. */
  private readonly bootId = randomUUID();
  private revisions = new Map<string, number>();
  private projectRevision = 0;
  // Long-poll reads each listen while they wait, so there can be many.
  bus = new EventEmitter().setMaxListeners(0);
  constructor(path: string) {
    this.database = openDatabase(path);
    this.messages = new MessageStore(this.database);
  }

  beginEventStorage(taskId: string, turn: number) {
    return this.eventStorage.begin(taskId, turn);
  }

  private get orm() {
    return this.database.orm;
  }

  /**
   * Runs `fn` in one transaction, so the task state and events it writes
   * commit together. Listeners hear its events only after the commit; on a
   * rollback they hear nothing, and saved tasks get back their `updated_at`.
   */
  transaction<T>(fn: () => T): T {
    if (this.saved) {
      throw new Error("A transaction is already open; run this work inside it");
    }

    const saved: [Task, string][] = [];
    this.saved = saved;
    this.changed = new Set();

    try {
      return this.database.transaction(() => {
        try {
          return fn();
        } finally {
          // Closed before the commit's listeners run, so they can open their own.
          this.saved = undefined;
          this.changed = undefined;
        }
      });
    } catch (error) {
      for (const [t, updated] of saved.reverse()) t.updated_at = updated;
      throw error;
    }
  }

  save(t: Task) {
    const updated = t.updated_at;
    t.updated_at = now();
    const body = JSON.stringify(t);

    try {
      this.orm
        .insert(tasks)
        .values({ id: t.id, owner: t.owner, body })
        .onConflictDoUpdate({ target: tasks.id, set: { body } })
        .run();
    } catch (error) {
      t.updated_at = updated;
      throw error;
    }

    this.saved?.push([t, updated]);
    this.markChanged(t.owner);
  }

  /**
   * Deletes a task. Its events and pending forms
   * reference it and are deleted with it, and the service's database returns
   * their space to the file system.
   */
  delete(id: string, owner: string) {
    this.get(id, owner);

    this.orm
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.owner, owner)))
      .run();

    this.database.client.exec("PRAGMA incremental_vacuum");

    this.markChanged(owner);
  }

  /**
   * Announces `change` for an owner once the open transaction commits, once
   * per transaction however many writes it holds; at once outside one.
   * Other task storage built on this connection announces its writes here.
   */
  markChanged(owner: string) {
    const changed = this.changed;

    if (!changed) {
      this.announce([owner]);

      return;
    }

    if (!changed.size) this.database.afterCommit(() => this.announce(changed));
    changed.add(owner);
  }

  private announce(owners: Iterable<string>) {
    for (const owner of owners) {
      this.revisions.set(owner, (this.revisions.get(owner) ?? 0) + 1);
      this.publish("change", owner);
    }
  }

  /** Announces a change to the project list, which every owner shares. */
  projectsChanged() {
    this.projectRevision++;
    this.publish("change", undefined);
  }

  /**
   * An opaque token for the state of an owner's tasks and the project list.
   * It differs whenever either has changed, including across a restart, so
   * clients compare it only for equality.
   */
  revision(owner: string) {
    const count = (this.revisions.get(owner) ?? 0) + this.projectRevision;

    return `${this.bootId}:${count}`;
  }

  /**
   * An owner's tasks, newest first, in a conversation or repository when
   * given.
   */
  list(owner: string, filters: TaskFilters): Task[] {
    return this.reads.rows("task_list", () =>
      readTasks(this.orm, taskFilters(owner, filters), newest),
    );
  }

  /**
   * An owner's tasks matching `filters`, newest first, with their repository
   * and whether each is a completed task the owner has read.
   */
  readCompletedFlags(owner: string, filters: TaskFilters) {
    return readCompletedFlags(this.orm, taskFilters(owner, filters), newest);
  }

  /** Every owner's tasks, newest first. */
  all(): Task[] {
    return readTasks(this.orm, undefined, newest);
  }

  /** An owner's newest task in a conversation. */
  latestInConversation(owner: string, conversation: string): Task | undefined {
    return readTasks(
      this.orm,
      taskFilters(owner, { conversation }),
      newest,
      1,
    )[0];
  }

  /** Every owner's tasks with one of `statuses`, oldest first. */
  withStatus(statuses: readonly Task["status"][]): Task[] {
    return readTasks(
      this.orm,
      inArray(tasks.status, statuses),
      asc(tasks.created_at),
    );
  }

  get(id: string, owner: string): Task {
    const task = this.find(id, owner);
    if (!task) throw new Error("Task not found");

    return task;
  }

  /** An owner's task, or undefined when it has none with this id. */
  find(id: string, owner: string): Task | undefined {
    return readTasks(
      this.orm,
      and(eq(tasks.id, id), eq(tasks.owner, owner)),
    )[0];
  }

  event<K extends EventType, D extends EventPayloadMap[K] = EventPayloadMap[K]>(
    t: Task,
    type: K,
    ...args: HasNoPayload<EventPayloadMap[K]> extends true
      ? [data?: D]
      : [data: D]
  ): Event {
    const data = (args[0] ?? {}) as Record<string, unknown>;

    return this.writeEvent(t, type, data);
  }

  /** Records a provider-owned event through the explicit opaque extension path. */
  eventOpaque(
    t: Task,
    type: string,
    data: Record<string, unknown> = {},
  ): Event {
    return this.writeEvent(t, type, data);
  }

  private writeEvent(
    t: Task,
    type: string,
    data: Record<string, unknown>,
  ): Event {
    const event = insertEvent(
      this.database,
      this.eventStorage,
      t.id,
      type,
      data,
    );

    this.database.afterCommit(() => this.publish("event", event, t.owner));
    this.markChanged(t.owner);

    return event;
  }

  /** Isolate listener failures after commit so consumers can still catch up. */
  private publish(name: "event" | "change", ...args: unknown[]) {
    publishListeners(this.bus, name, args);
  }

  events(id: string, owner: string, after = 0): Event[] {
    this.get(id, owner);

    return this.orm
      .select(eventColumns)
      .from(events)
      .where(and(eq(events.task_id, id), gt(events.id, after)))
      .orderBy(events.id)
      .limit(PAGE)
      .all()
      .map(decodeEvent);
  }

  /** Resolves an original response after checking task ownership. */
  originalResponse(id: string, owner: string, responseRef: string) {
    this.get(id, owner);

    return readOriginalResponse(this.database, id, responseRef);
  }

  /**
   * The id of a task's event `depth` places from its newest, so the newest
   * `depth` events are those from it on; 0 when there are fewer than that.
   * `depth` is at least 1: the query offsets by `depth - 1`.
   */
  eventWindowStart(id: string, depth: number): number {
    return (
      this.orm
        .select({ id: events.id })
        .from(events)
        .where(eq(events.task_id, id))
        .orderBy(desc(events.id))
        .limit(1)
        .offset(depth - 1)
        .get()?.id ?? 0
    );
  }

  /**
   * The id of the `depth`th newest of a task's events after `after` and
   * through `through`, so those events from it on are the newest `depth`;
   * `after + 1` when there are fewer than that.
   */
  rangeWindowStart(
    id: string,
    after: number,
    through: number,
    depth: number,
  ): number {
    return (
      this.orm
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.task_id, id),
            gt(events.id, after),
            lte(events.id, through),
          ),
        )
        .orderBy(desc(events.id))
        .limit(1)
        .offset(depth - 1)
        .get()?.id ?? after + 1
    );
  }

  /**
   * What the owner has read of a task: whether it has a reply, outcome or
   * request they haven't read, and the newest event they had read.
   */
  readState(id: string): ReadState {
    return readStates(this.orm, eq(tasks.id, id)).get(id)!;
  }

  /** The read state of each of an owner's tasks matching `filters`, by id. */
  readStates(owner: string, filters: TaskFilters): Map<string, ReadState> {
    return readStates(this.orm, taskFilters(owner, filters));
  }

  /**
   * Records that the owner has read a task through event `through`, or its
   * newest event without one. It never moves back, never passes the newest
   * event and clears the task's unread mark.
   */
  markRead(t: Task, through?: number) {
    const newest = this.lastEventId(t.id);
    const read = Math.min(through ?? newest, newest);

    this.orm
      .insert(taskRead)
      .values({ task_id: t.id, through: read, unread: false })
      .onConflictDoUpdate({
        target: taskRead.task_id,
        set: { through: sql`max(${taskRead.through}, ${read})`, unread: false },
      })
      .run();

    this.markChanged(t.owner);
  }

  /** Marks a task unread from event `from` on; unlike `markRead`, it can move the read point back. */
  markUnreadFrom(t: Task, from: number) {
    const through = Math.min(from - 1, this.lastEventId(t.id));
    const mark = { through, unread: false };

    this.orm
      .insert(taskRead)
      .values({ task_id: t.id, ...mark })
      .onConflictDoUpdate({ target: taskRead.task_id, set: mark })
      .run();

    this.markChanged(t.owner);
  }

  /** Marks a task unread until the owner next sees it. */
  markUnread(t: Task) {
    this.orm
      .insert(taskRead)
      .values({ task_id: t.id, through: 0, unread: true })
      .onConflictDoUpdate({ target: taskRead.task_id, set: { unread: true } })
      .run();

    this.markChanged(t.owner);
  }

  /** The id of a task's `task.turn_ended` event for a turn; absent until it ends. */
  turnEnded(id: string, turn: number): number | undefined {
    return this.orm
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.task_id, id),
          eq(events.type, "task.turn_ended"),
          eq(sql`json_extract(${events.data}, '$.turn')`, turn),
        ),
      )
      .orderBy(events.id)
      .limit(1)
      .get()?.id;
  }

  /** A task's first event after `after` with one of `types`. */
  nextEventOfType(id: string, after: number, types: string[]) {
    return this.orm
      .select({ id: events.id, type: events.type })
      .from(events)
      .where(
        and(
          eq(events.task_id, id),
          gt(events.id, after),
          inArray(events.type, types),
        ),
      )
      .orderBy(events.id)
      .limit(1)
      .get();
  }

  /**
   * A task's events after `after`, and before `before` when given, a page at a
   * time. Internal: callers check the task's owner first.
   */
  taskEvents(id: string, after: number, before?: number): Event[] {
    return this.orm
      .select(eventColumns)
      .from(events)
      .where(
        and(
          eq(events.task_id, id),
          gt(events.id, after),
          before === undefined ? undefined : lt(events.id, before),
        ),
      )
      .orderBy(events.id)
      .limit(PAGE)
      .all()
      .map(decodeEvent);
  }

  recentEvents(id: string, owner: string): Event[] {
    this.get(id, owner);

    return this.orm
      .select(eventColumns)
      .from(events)
      .where(eq(events.task_id, id))
      .orderBy(desc(events.id))
      .limit(200)
      .all()
      .reverse()
      .map(decodeEvent);
  }

  /** The id of the latest event, or of a task's latest one; 0 before any. */
  lastEventId(id?: string): number {
    const row = this.orm
      .select({ id: max(events.id) })
      .from(events)
      .where(id === undefined ? undefined : eq(events.task_id, id))
      .get();

    return row?.id ?? 0;
  }

  /** A task's latest event of a type, such as its latest `agent.reply`. */
  latestEvent(id: string, type: string): Event | undefined {
    const row = this.orm
      .select(eventColumns)
      .from(events)
      .where(and(eq(events.task_id, id), eq(events.type, type)))
      .orderBy(desc(events.id))
      .limit(1)
      .get();

    return row && decodeEvent(row);
  }

  /** The latest event of `type` in each of an owner's tasks matching `filters`. */
  latestEvents(owner: string, type: string, filters: TaskFilters) {
    return latestEvents(this.orm, taskFilters(owner, filters), type);
  }

  /** Every event of the given types for a task, in order, with no page limit. */
  eventsOfTypes(id: string, types: string[]): Event[] {
    return this.orm
      .select(eventColumns)
      .from(events)
      .where(and(eq(events.task_id, id), inArray(events.type, types)))
      .orderBy(events.id)
      .all()
      .map(decodeEvent);
  }

  /** The events Chat shows, in order. */
  chatEvents(id: string): Event[] {
    return this.reads.rows("chat", () => chatEvents(this.orm, id));
  }

  /** A task's Chat events of `types`, in order, for its conversation. */
  conversationEvents(id: string, types: readonly string[]): Event[] {
    return chatEvents(this.orm, id, types);
  }

  close() {
    this.reads.flush();
    this.database.close();
  }
}
