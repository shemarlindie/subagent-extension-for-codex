import type {
  FileEdit,
  RunContext,
} from "../../src/service/features/providers/types.js";
import { startSchema, type Task } from "../../src/shared/tasks/model.js";

export function task(id = "task_fixture"): Task {
  return {
    ...startSchema.parse({
      repository: "/repo",
      provider: "fixture",
      description: "Exercise the fixture provider",
    }),
    id,
    title: "Fixture test",
    owner: "alice",
    created_by: "user",
    repository: "/fixture/repository",
    status: "running",
    created_at: "2026-10-10T00:00:00.000Z",
    updated_at: "2026-10-10T00:00:00.000Z",
    turn: 1,
    runtime_ms: 0,
    instructions: [],
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
  };
}

export function context(currentTask = task()) {
  const edits: FileEdit[] = [];
  const controller = new AbortController();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const inputs: string[] = [];
  const sessions: { id: string; stateRef: string }[] = [];

  const runContext = {
    task: currentTask,
    fileChanged: (edit: FileEdit) => {
      edits.push(edit);
    },
    editUnrecorded: () => {},
    signal: controller.signal,
    acceptSteers: () => {},
    steerTaken: () => {},
    delta: () => {},
    emit: (type: string, data: Record<string, unknown>) =>
      events.push({ type, data }),
    emitOpaque: (type: string, data: Record<string, unknown>) =>
      events.push({ type, data }),
    session: (id: string, stateRef: string) => sessions.push({ id, stateRef }),
    input: async (tool: string) => {
      inputs.push(tool);

      return tool === "AskUserQuestion"
        ? { input: { answer: "fixture answer" } }
        : { approved: true };
    },
  } as unknown as RunContext;

  return { edits, events, inputs, sessions, runContext };
}
