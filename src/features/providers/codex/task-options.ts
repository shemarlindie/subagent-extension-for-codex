import { z } from "zod";

import type { Task } from "../../tasks/model.js";
import { optionsForProvider, withProviderOptions } from "../options.js";

export const codexTaskOptionsSchema = z.strictObject({
  native_turn_id: z.string().optional(),
});

export type CodexTaskOptions = z.infer<typeof codexTaskOptionsSchema>;

export function readCodexTaskOptions(task: Pick<Task, "provider_options">) {
  return codexTaskOptionsSchema.parse(
    optionsForProvider(task.provider_options, "codex"),
  );
}

export function writeCodexTaskOptions(
  task: Pick<Task, "provider_options">,
  options: CodexTaskOptions,
) {
  return withProviderOptions(task.provider_options, "codex", options);
}
