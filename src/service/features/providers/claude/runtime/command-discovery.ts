import type { query, SlashCommand } from "@anthropic-ai/claude-agent-sdk";

import type { ProviderCommand } from "../../../../../core/shared/providers/types.js";
import type { Task } from "../../../../../core/shared/tasks/model.js";
import { readClaudeTaskOptions } from "../../../../../providers/claude/shared/task-options.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { ClaudeCli } from "../configuration/executable.js";
import { CachedRead, READ_CACHE_MS, turnlessSession } from "./session-reads.js";

/**
 * One row per name. A name both Claude Code and a skill use runs Claude
 * Code's command, so that row wins.
 */
function commandsByName(commands: SlashCommand[]): ProviderCommand[] {
  const byName = new Map<string, SlashCommand>();

  for (const command of commands) {
    if (!byName.has(command.name) || command.builtin) {
      byName.set(command.name, command);
    }
  }

  return [...byName.values()].map((c) => ({
    name: c.name,
    description: c.description,
    argument_hint: c.argumentHint,
    aliases: c.aliases ?? [],
    builtin: !!c.builtin,
  }));
}

/**
 * The commands a task's session offers, including its project's skills, read
 * in the task's folder by a session without a turn. Each folder and
 * settings-file choice keeps its own cached list.
 */
export class ClaudeCommands {
  private reads = new Map<string, CachedRead<ProviderCommand[]>>();

  constructor(
    private launch: typeof query,
    private cli: Pick<ClaudeCli, "executable">,
  ) {}

  list(task: Task) {
    // Before its first turn, a task has only its repository.
    const cwd = task.workspace ?? task.repository;
    const { settings_files } = readClaudeTaskOptions(task).claude_policy;
    const key = JSON.stringify([cwd, settings_files]);
    let read = this.reads.get(key);

    if (!read) {
      read = new CachedRead(
        () => this.discover(cwd, settings_files),
        "provider.commands_failed",
      );

      this.reads.set(key, read);
    }

    return read.get();
  }

  private async discover(cwd: string, settingsFiles: boolean) {
    const started = performance.now();

    const turnless = turnlessSession(this.launch, settingsFiles, {
      pathToClaudeCodeExecutable: await this.cli.executable(),
      cwd,
    });

    try {
      const commands = commandsByName(
        await Promise.race([
          turnless.session.supportedCommands(),
          turnless.timeout,
        ]),
      );

      logEvent("info", "provider.commands_read", {
        duration_ms: performance.now() - started,
        count: commands.length,
      });

      return { result: commands, expires: Date.now() + READ_CACHE_MS };
    } finally {
      turnless.close();
    }
  }
}
