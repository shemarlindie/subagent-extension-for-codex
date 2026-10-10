// Pure helpers for the panel dev host (host.tsx), kept apart from the
// component so tests can import them without mounting the page.
import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Task } from "../../../src/shared/tasks/model";
import { type PreviewOptions, previewTool } from "../scenarios/tools";

export type Settings = {
  source: "fixtures" | "live";
  launch: "thread" | "global";
  theme: "light" | "dark";
  displayMode: McpUiDisplayMode;
  width: string;
  canSend: boolean;
  canShare: boolean;
  showInspector: boolean;
  threadId: string;
  cwd: string;
  /** Fixtures only; the live service uses the user's own setting. */
  autoRegister: boolean;
  /** Fixtures only; the live service checks the installed Claude Code. */
  claudeUnavailable: boolean;
  /** Fixtures only; lets the preview simulate successful budget updates. */
  successfulBudgetUpdates: boolean;
  /** Projects registered in fixtures mode, kept until Reset. */
  addedProjects: string[];
  styles: string;
};

/** Codex sends cwd as a file URI, so convert typed paths before storing them. */
export function normalizeCwd(value: string) {
  const cwd = value.trim();
  if (!cwd.startsWith("/")) return cwd;
  // The pathname setter also escapes "#" and "?", which encodeURI keeps.
  const url = new URL("file:///");
  url.pathname = cwd;

  return url.href;
}

/** Saved settings over the defaults; unreadable storage falls back to them. */
export function settingsFrom(defaults: Settings, stored: string | null) {
  try {
    const parsed = JSON.parse(stored!) as Record<string, unknown>;

    const saved = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => Object.hasOwn(defaults, key)),
    ) as Partial<Settings>;

    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

export function parseStyles(text: string): Record<string, string> | undefined {
  try {
    const value = JSON.parse(text);

    // Accept either the variables map or a whole hostContext.styles object.
    return value?.variables ?? value;
  } catch {
    return undefined;
  }
}

/** Request metadata Codex attaches to tool calls from a thread. */
export function codexMeta(
  settings: Pick<Settings, "launch" | "threadId" | "cwd">,
) {
  if (settings.launch === "global") return undefined;

  return {
    ...(settings.threadId ? { threadId: settings.threadId } : {}),
    ...(settings.cwd
      ? { "codex/sandbox-state-meta": { sandboxCwd: settings.cwd } }
      : {}),
  };
}

/**
 * Fixture stand-in for the service's withConversation: Codex launches with
 * empty arguments, and the service turns the thread metadata into these.
 */
export function fixtureLaunchArgs(
  settings: Pick<Settings, "launch" | "threadId" | "cwd">,
) {
  const meta = codexMeta(settings);
  if (!meta) return {};

  return {
    ...(meta.threadId ? { conversation_id: meta.threadId } : {}),
    ...(meta["codex/sandbox-state-meta"]
      ? { host_directory: meta["codex/sandbox-state-meta"].sandboxCwd }
      : {}),
  };
}

/**
 * Fixture tools the Vite dev server answers with the real service code
 * (dev/panel/fixture-service/service.ts), for behavior the browser fixtures cannot fake.
 * The browser fixtures do not answer them. Changes are read from real Git
 * repositories built from dev/panel/scenarios/change-fixtures.ts.
 */
export const FIXTURE_SERVICE_TOOLS: string[] = [
  "get_user_agent_changes",
  "get_user_agent_change_counts",
  "get_user_agent_changed_file",
  "remove_user_agent_worktree",
  "delete_user_agent_branch",
];

export const FIXTURE_SERVICE_PATH = "/fixture-service/tools/";

/** Calls a fixture tool on the Vite dev server, shaped like fixtureCall's result. */
export async function fixtureServiceCall(
  name: string,
  args: Record<string, unknown>,
  request: typeof fetch = fetch,
): Promise<CallToolResult> {
  try {
    const response = await request(FIXTURE_SERVICE_PATH + name, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    const body = (await response.json()) as {
      result?: unknown;
      error?: string;
    };

    if (!response.ok) throw new Error(body.error ?? response.statusText);

    return {
      content: [{ type: "text", text: JSON.stringify(body.result) }],
      structuredContent: { result: body.result },
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

/** A fixture result shaped like the service's MCP tool result. */
export function fixtureCall(
  name: string,
  args: Record<string, unknown>,
  options: PreviewOptions,
) {
  try {
    const result = previewTool(name, args, options);

    // The openers and settings tools return their payload unwrapped.
    const unwrapped =
      name.startsWith("open_codex_subagent_extension") ||
      name.endsWith("_agent_settings");

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: (unwrapped ? result : { result }) as Record<
        string,
        unknown
      >,
    } satisfies CallToolResult;
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: String(error) }],
    } satisfies CallToolResult;
  }
}

export type Thread = { id: string; latest: string; tasks: number };

/** Conversations that have tasks, newest activity first. */
export function threadsOf(tasks: Task[]): Thread[] {
  const threads = new Map<string, Thread & { created: string }>();

  for (const task of tasks) {
    if (!task.conversation_id) continue;
    const thread = threads.get(task.conversation_id);

    if (!thread)
      threads.set(task.conversation_id, {
        id: task.conversation_id,
        latest: task.title,
        created: task.created_at,
        tasks: 1,
      });
    else {
      thread.tasks++;
      // The label names the thread's most recent task.
      if (task.created_at > thread.created)
        Object.assign(thread, { latest: task.title, created: task.created_at });
    }
  }

  return [...threads.values()]
    .sort((a, b) => b.created.localeCompare(a.created))
    .map(({ id, latest, tasks }) => ({ id, latest, tasks }));
}

/** Picker label; long IDs such as UUIDs are shortened. */
export function threadLabel({ id, latest, tasks }: Thread) {
  const name = id.length > 12 ? `${id.slice(0, 8)}…` : id || "(none)";

  return tasks
    ? `${name} · ${latest} (${tasks} ${tasks === 1 ? "task" : "tasks"})`
    : `${name} · no tasks`;
}
