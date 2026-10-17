import { randomUUID } from "node:crypto";

import type { Task } from "../../../../shared/tasks/model.js";
import type { ProviderTaskPolicy } from "../../providers/task-policy.js";
import type { RunContext } from "../../providers/types.js";
import type { Workspaces } from "../../workspaces/workspace.js";
import type { Store } from "../storage/store.js";

type InputResponse = Awaited<ReturnType<RunContext["input"]>>;

/** Where a waiting task's changes stop, and start again when it resumes. */
type ChangeRecorder = Pick<Workspaces, "recordEnd" | "resume">;

/** Cancel a queued input without letting later requests bypass its predecessor. */
async function waitForInputSlot(previous: Promise<void>, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(new Error("Input interrupted"));
    };

    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();

    void previous.then(() => {
      signal.removeEventListener("abort", aborted);
      if (signal.aborted) reject(new Error("Input interrupted"));
      else resolve();
    });
  });
}

/** Serializes a turn's pending requests and resumes the worker when answered. */
export class PendingInput {
  private tail?: Promise<void>;
  private resolveInput?: (response: InputResponse) => void;

  constructor(
    private task: Task,
    private store: Store,
    private policy: ProviderTaskPolicy,
    private abortSignal: AbortSignal,
    private changes: ChangeRecorder,
  ) {}

  get waiting() {
    return !!this.resolveInput;
  }

  submit(response: InputResponse) {
    if (!this.resolveInput) throw new Error("No active input request");
    this.resolveInput(response);
  }

  request: RunContext["input"] = async (tool, input, signal, presentation) => {
    const t = this.task;

    if (this.abortSignal.aborted || signal?.aborted) {
      throw new Error("Input interrupted");
    }

    const policy = this.policy;
    const kind = policy.inputKind(tool);

    const approved =
      kind === "question" ? undefined : policy.decideInput(t, tool);

    if (approved !== undefined) {
      this.store.event(t, "agent.permission_decided", {
        tool,
        input,
        approval_mode: t.approval_mode ?? "ask_user",
        approved,
        authority: "policy",
      });

      return {
        approved,
        message: approved
          ? undefined
          : "Execution denied by task approval mode",
      };
    }

    const previous = this.tail ?? Promise.resolve();
    let release!: () => void;

    const released = new Promise<void>((resolve) => (release = resolve));

    this.tail = previous.then(() => released);

    const inputSignal = signal
      ? AbortSignal.any([this.abortSignal, signal])
      : this.abortSignal;

    try {
      await waitForInputSlot(previous, inputSignal);
      // The worker is blocked until the input comes, so its changes
      // stop here while it waits.
      await this.changes.recordEnd(t);
      if (inputSignal.aborted) throw new Error("Input interrupted");
      t.status = "waiting";

      t.waiting_reason =
        kind === "question" ? "waiting_for_user" : "waiting_for_permission";

      t.pending_input = {
        id: randomUUID(),
        tool,
        kind,
        input,
        ...(presentation ? { presentation } : {}),
      };

      this.store.transaction(() => {
        this.store.save(t);

        this.store.event(t, "agent.input_required", {
          request: t.pending_input,
        });
      });

      const response = await new Promise<InputResponse>((resolve, reject) => {
        const onAbort = () => {
          this.resolveInput = undefined;
          this.abortSignal.removeEventListener("abort", onAbort);
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("Input interrupted"));
        };

        this.abortSignal.addEventListener("abort", onAbort, {
          once: true,
        });

        signal?.addEventListener("abort", onAbort, { once: true });

        this.resolveInput = (r) => {
          this.abortSignal.removeEventListener("abort", onAbort);
          signal?.removeEventListener("abort", onAbort);
          this.resolveInput = undefined;
          delete t.pending_input;
          delete t.waiting_reason;
          t.status = "running";

          this.store.transaction(() => {
            this.store.save(t);

            this.store.event(t, "agent.input_submitted", {
              approved: r.approved,
            });
          });

          resolve(r);
        };
      });

      // The worker stays blocked until its changes are live again.
      if (t.end_tree) {
        await this.changes.resume(t);
        this.store.save(t);
      }

      return response;
    } finally {
      release();
    }
  };
}
