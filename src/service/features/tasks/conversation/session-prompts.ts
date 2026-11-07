import { eventPayload } from "../../../../shared/events/payload.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Changes } from "../../changes/changes.js";
import type { Provider } from "../../providers/types.js";
import type { Store } from "../storage/store.js";

/** Bounds each dependency's diff in a dependent's prompt. */
const MAX_DEPENDENCY_DIFF_CHARS = 50_000;
/** Bounds the earlier conversation a new session's prompt carries. */
const MAX_TRANSCRIPT_CHARS = 50_000;

type NewSessionReason = "no_session" | "session_unavailable";

/** Builds turn prompts and checks whether the provider can resume a session. */
export class SessionPrompts {
  constructor(
    private store: Store,
    private changes: Changes,
  ) {}

  /**
   * Why a later turn can't resume the task's session: there is none (the
   * task failed before it existed), or it belongs to another worker or the
   * provider rejects it. Undefined when it can resume.
   */
  async newSessionReason(
    t: Task,
    provider: Provider,
    ownerWorker: string,
  ): Promise<NewSessionReason | undefined> {
    if (!t.session_id) return "no_session";

    if (t.session_owner !== ownerWorker || !t.session_state_ref) {
      return "session_unavailable";
    }

    try {
      await provider.taskPolicy.validateSession?.(t);
    } catch {
      return "session_unavailable";
    }

    return undefined;
  }

  /**
   * A new session's prompt: the first turn's, then, on a later turn, the
   * earlier conversation, then the messages the worker hasn't received.
   */
  async sessionPrompt(t: Task) {
    const deps = t.depends_on.map((id) => this.store.get(id, t.owner));

    const workspaceContext = this.workspaceContext(t);

    const dependencyContext = await Promise.all(
      deps.map(async (d) =>
        [this.dependencyReply(d), ...this.dependencyChanges(d)].join("\n"),
      ),
    );

    const transcript = t.turn > 1 ? this.transcript(t) : "";

    return [
      t.description,
      ...(workspaceContext ? [workspaceContext] : []),
      ...t.context,
      ...dependencyContext,
      ...(transcript ? [transcript] : []),
      ...t.instructions.slice(t.instructions_sent).map((m) => m.message),
    ].join("\n\n");
  }

  /** What a new session needs to know about working in the project folder. */
  private workspaceContext(t: Task) {
    if (t.workspace_strategy !== "current_repo") return "";

    if (t.no_git) {
      return "This task runs directly in a folder with no Git history. Write profiles edit its files directly, and those edits can't be undone with Git. Preserve unrelated files.";
    }

    if (!t.base_commit) {
      return "This task runs directly in a Git repository that had no commits when the task started. Write profiles edit its files directly, and those edits may not be recoverable from Git. Preserve unrelated files.";
    }

    return "This task runs in the current repository, including staged, unstaged and untracked files. Write profiles edit this checkout directly. Preserve unrelated uncommitted changes.";
  }

  /** A resumed session's prompt: only the messages it hasn't received. */
  resumedPrompt(t: Task) {
    const unsent = t.instructions
      .slice(t.instructions_sent)
      .map((m) => m.message);

    return [
      ...(t.workspace_strategy === "current_repo"
        ? [
            `Note: this ${t.no_git ? "folder" : "checkout"} is shared, so it may have changed since your last turn, including edits by the user.`,
          ]
        : []),
      ...(unsent.length ? unsent : ["Continue the task."]),
    ].join("\n\n");
  }

  /**
   * The messages and replies a session already received, for a new
   * session's prompt, newest kept within a bound. Messages the worker hasn't
   * received are left out, since the prompt ends with them.
   */
  private transcript(t: Task) {
    const received = new Set(
      t.instructions.slice(0, t.instructions_sent).map((m) => m.id),
    );

    const entries: string[] = [];
    let length = 0;

    const events = this.store
      .eventsOfTypes(t.id, ["task.instruction", "agent.reply"])
      .reverse();

    for (const e of events) {
      const instruction = eventPayload(e, "task.instruction");
      const reply = eventPayload(e, "agent.reply");

      if (instruction && !received.has(instruction.message_id)) {
        continue;
      }

      let entry: string | undefined;

      if (reply) {
        entry = `Your reply:\n${reply.text}`;
      } else if (instruction) {
        const sender = instruction.from === "parent" ? "Parent agent" : "User";
        entry = `${sender}:\n${instruction.message}`;
      }

      if (entry === undefined) continue;

      if (length + entry.length > MAX_TRANSCRIPT_CHARS) {
        entries.unshift("… (earlier conversation left out)");
        break;
      }

      entries.unshift(entry);
      length += entry.length;
    }

    return entries.length
      ? [
          "This task continues in a new session. The conversation so far, after the request above:",
          ...entries,
          "The new message follows.",
        ].join("\n\n")
      : "";
  }

  /** A dependency's latest reply for a dependent's prompt. */
  private dependencyReply(d: Task) {
    const reply = this.store.latestEvent(d.id, "agent.reply");
    const payload = reply ? eventPayload(reply, "agent.reply") : undefined;

    return payload
      ? `Dependency ${d.id} replied:\n${payload.text}`
      : `Dependency ${d.id} finished without a reply.`;
  }

  /**
   * A dependency's recorded whole-task edits for a dependent's prompt, up to
   * a bound, in whole files, with notes for edits that weren't recorded.
   */
  private dependencyChanges(d: Task) {
    const changes = this.changes.changes(
      d,
      "task",
      undefined,
      MAX_DEPENDENCY_DIFF_CHARS,
    );

    const incomplete = changes.files.filter((file) => file.incomplete),
      notes = [
        ...(incomplete.length
          ? [
              `Edits to ${incomplete.map((file) => file.path).join(", ")} weren't recorded, so they have no diff.`,
            ]
          : []),
        ...(changes.unrecorded_commands
          ? [
              `Commands also ${d.no_git ? "may have changed" : "changed"} files that weren't recorded.`,
            ]
          : []),
      ];

    if (!changes.diff) return notes;

    const shown = changes.diff.slice(0, MAX_DEPENDENCY_DIFF_CHARS),
      count = changes.files.length;

    return [
      `Dependency ${d.id}'s recorded edits (${count} ${count === 1 ? "file" : "files"}, +${changes.additions} −${changes.deletions}):`,
      shown,
      ...(changes.next_cursor || shown.length < changes.diff.length
        ? ["… (diff truncated)"]
        : []),
      ...notes,
    ];
  }
}
