import type { Task } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import { claudeTaskOptionsSchema } from "./task-options-contract.generated.js";

export {
  claudeStartOptionsSchema,
  claudeTaskOptionsSchema,
} from "./task-options-contract.generated.js";

export function readClaudeTaskOptions(task: Pick<Task, "provider_options">) {
  return claudeTaskOptionsSchema.parse(
    optionsForProvider(task.provider_options, "claude"),
  );
}
