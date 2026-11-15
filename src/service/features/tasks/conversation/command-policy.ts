import { slashCommand } from "../../../../shared/tasks/conversation/commands.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Provider } from "../../providers/types.js";

/** The slash commands a task can run, for suggestions. */
export async function taskCommands(provider: Provider | undefined, t: Task) {
  const commands = (await provider?.commands?.(t)) ?? [];

  return commands.filter(
    ({ name, builtin }) =>
      !provider?.taskPolicy.commandRefusal?.(name, builtin),
  );
}

/** Refuses a message whose command the task's provider won't run in a task. */
export async function checkCommand(
  provider: Provider | undefined,
  t: Task,
  message: string,
) {
  const name = slashCommand(message);
  if (!name || !provider?.taskPolicy.commandRefusal) return;

  // A supported built-in runs without the list. Any other name could be an
  // alias of a refused command.
  if (!provider.taskPolicy.commandRefusal(name, true)) return;
  let commands;

  try {
    commands = (await provider.commands?.(t)) ?? [];
  } catch {
    // Discovery already logs the failure.
    throw new Error(
      `Couldn't check /${name} against the task's commands. Try again shortly.`,
    );
  }

  // An alias runs its command.
  const command = commands.find(
    (c) => c.name === name || c.aliases.includes(name),
  );

  const reason = provider.taskPolicy.commandRefusal(
    command?.name ?? name,
    command?.builtin ?? false,
  );

  if (reason) throw new Error(`/${name} can't run in a task. ${reason}`);
}
