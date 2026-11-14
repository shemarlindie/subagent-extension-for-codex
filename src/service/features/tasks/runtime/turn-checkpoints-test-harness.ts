import type { RunContext } from "../../providers/types.js";

/** Holds named turns until the test releases them or task control interrupts. */
export class TurnCheckpoints {
  private readonly turns = new Map<
    number,
    {
      ready: ReturnType<typeof Promise.withResolvers<void>>;
      finished: ReturnType<typeof Promise.withResolvers<void>>;
    }
  >();

  constructor(...turns: number[]) {
    for (const turn of turns) {
      this.turns.set(turn, {
        ready: Promise.withResolvers<void>(),
        finished: Promise.withResolvers<void>(),
      });
    }
  }

  beforeReply = async (context: RunContext) => {
    const checkpoint = this.turns.get(context.task.turn);
    if (!checkpoint) return;
    checkpoint.ready.resolve();
    await checkpoint.finished.promise;
  };

  ready(turn = 1) {
    return this.checkpoint(turn).ready.promise;
  }

  release(turn = 1) {
    this.checkpoint(turn).finished.resolve();
  }

  private checkpoint(turn: number) {
    const checkpoint = this.turns.get(turn);
    if (!checkpoint) throw new Error(`Turn ${turn} has no checkpoint`);

    return checkpoint;
  }
}
