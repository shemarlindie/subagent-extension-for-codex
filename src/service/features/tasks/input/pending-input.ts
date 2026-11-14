import { randomUUID } from "node:crypto";

import type { Task } from "../../../../shared/tasks/model.js";
import type { ProviderTaskPolicy } from "../../providers/task-policy.js";
import type { RunContext } from "../../providers/types.js";
import {
  recordTaskTiming,
  type TimingOutcome,
  timingOutcome,
} from "../runtime/timing.js";
import type { Store } from "../storage/store.js";

type InputResponse = Awaited<ReturnType<RunContext["input"]>>;

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
  /** Finished user waits; serialization keeps them from overlapping. */
  private waited = 0;
  private waitingSince?: number;

  /** How long this turn's requests have waited for the user so far. */
  get waitedMs() {
    const current =
      this.waitingSince === undefined
        ? 0
        : performance.now() - this.waitingSince;

    return this.waited + current;
  }

  constructor(
    private task: Task,
    private store: Store,
    /** Absent when the task's provider is no longer enabled, so its turn fails. */
    private policy: ProviderTaskPolicy | undefined,
    private abortSignal: AbortSignal,
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
    if (!policy) throw new Error("Provider is not enabled");
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

    const requested = performance.now();
    // Only the request holding the slot owns the shared waiting clock.
    let shown: number | undefined;
    let outcome: TimingOutcome = "success";

    try {
      await waitForInputSlot(previous, inputSignal);
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

      shown = this.waitingSince = performance.now();

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

      return response;
    } catch (error) {
      outcome = timingOutcome(error, inputSignal);
      throw error;
    } finally {
      if (shown !== undefined) this.waitingSince = undefined;
      release();
      this.recordWait(kind, outcome, requested, shown);
    }
  };

  /**
   * Records one request's wait for the user, from when it was shown, and how
   * long it waited before that behind earlier requests.
   */
  private recordWait(
    kind: string,
    outcome: TimingOutcome,
    requested: number,
    shown: number | undefined,
  ) {
    const ended = performance.now();
    const waited = shown === undefined ? 0 : ended - shown;
    this.waited += waited;

    recordTaskTiming({
      phase: "input_wait",
      task_id: this.task.id,
      turn: this.task.turn,
      input_kind: kind,
      outcome,
      duration_ms: waited,
      queued_ms: (shown ?? ended) - requested,
    });
  }
}
