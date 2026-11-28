import { builtinModules } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";

const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);

/** Colocated tests and the `*-test-harness` modules they share are test code; imports may omit the extension. */
export const testModule = /(?:\.test|-test-harness)(?:\.[cm]?[jt]sx?)?$/;

// Remove each exception when its owner stops importing the adapter.
const exceptions = new Map([
  ["src/core/service/features/providers/config.ts", "providers/claude"],
  [
    "src/core/service/features/tasks/runtime/start-request.ts",
    "providers/claude",
  ],
  ["src/core/service/platform/server/mcp.ts", "hosts/codex"],
  ["src/core/service/platform/server/tools/user-tools.ts", "hosts/codex"],
  ["src/core/service/platform/service/about.ts", "providers/claude"],
  ["src/core/shared/providers/metadata.ts", "providers/claude"],
  ["src/core/shared/providers/presentation.ts", "providers/claude"],
  ["src/core/shared/providers/settings.ts", "providers/claude"],
  ["src/panel/features/delegation/delegate-form.tsx", "providers/claude"],
  ["src/panel/features/delegation/inherited-permission.ts", "providers/claude"],
  [
    "src/panel/features/delegation/new-task/new-task-composer.tsx",
    "providers/claude",
  ],
  [
    "src/panel/features/delegation/new-task/options/permission-chip.tsx",
    "providers/claude",
  ],
  ["src/panel/features/delegation/use-async-defaults.ts", "providers/claude"],
  [
    "src/panel/features/tasks/chat/composer/context-usage-meter.tsx",
    "providers/claude",
  ],
  [
    "src/panel/features/tasks/chat/composer/prompt-cache-timer.tsx",
    "providers/claude",
  ],
  [
    "src/panel/features/tasks/chat/composer/task-run-settings.tsx",
    "providers/claude",
  ],
]);

function sourceLocation(path) {
  if (/^src\/main(?:\.[jt]s)?$/.test(path)) {
    return { owner: "main", runtime: "service" };
  }

  if (path.startsWith("src/panel/")) {
    return { owner: "panel", runtime: "panel" };
  }

  const match =
    /^src\/(core|(?:providers|hosts)\/[^/]+)\/(service|shared)\//.exec(path);

  if (match) return { owner: match[1], runtime: match[2] };
}

function canImportOwner(from, to) {
  if (to === "main") return false;
  if (from === to || to === "core") return true;
  if (to === "panel") return false;

  return (
    from === "main" ||
    (from.startsWith("hosts/") && to.startsWith("providers/"))
  );
}

export const sourceBoundaries = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      stale: "Remove the unused dependency exception for {{target}}.",
      boundary:
        "{{owner}} source cannot import {{target}}. Use feature-owned shared contracts for cross-runtime data.",
    },
  },
  create(context) {
    const root = context.cwd;
    const filename = context.filename;
    const localFile = relative(root, filename).replaceAll("\\", "/");

    const source = sourceLocation(localFile);
    if (!source || testModule.test(localFile)) return {};

    const exception = exceptions.get(localFile);
    let usedException = false;

    function check(node, value, declaration = node) {
      if (typeof value !== "string") return;
      let target;

      if (value.startsWith(".") || isAbsolute(value)) {
        const dependency = relative(
          root,
          resolve(filename, "..", value),
        ).replaceAll("\\", "/");

        const destination = sourceLocation(dependency);

        if (testModule.test(dependency)) {
          target = "test code";
        } else if (!destination) {
          target = dependency.match(/^(dev|tests)\//)?.[1];
        } else if (
          destination.runtime !== source.runtime &&
          destination.runtime !== "shared"
        ) {
          target = destination.runtime;
        } else if (!canImportOwner(source.owner, destination.owner)) {
          if (destination.owner === exception) usedException = true;
          else target = destination.owner;
        }
      } else if (value.startsWith("node:") || builtins.has(value)) {
        if (source.runtime !== "service") target = "Node built-ins";
      } else if (
        source.runtime === "shared" &&
        /^(?:@anthropic-ai\/claude-agent-sdk|drizzle-orm)(?:\/|$)/.test(value)
      ) {
        if (
          value === "@anthropic-ai/claude-agent-sdk" &&
          localFile === "src/providers/claude/shared/events.ts" &&
          (declaration.type === "TSImportType" ||
            declaration.importKind === "type" ||
            declaration.exportKind === "type" ||
            (declaration.specifiers?.length > 0 &&
              declaration.specifiers.every(
                (specifier) =>
                  specifier.type === "ImportSpecifier" &&
                  specifier.importKind === "type",
              )))
        ) {
          return;
        }

        target = "runtime packages";
      }

      if (target) {
        context.report({
          node,
          messageId: "boundary",
          data: { owner: localFile, target },
        });
      }
    }

    return {
      "Program:exit"(node) {
        if (exception && !usedException) {
          context.report({
            node,
            messageId: "stale",
            data: { target: exception },
          });
        }
      },
      ImportDeclaration: (node) => check(node.source, node.source.value, node),
      ExportNamedDeclaration: (node) =>
        node.source && check(node.source, node.source.value, node),
      ExportAllDeclaration: (node) =>
        check(node.source, node.source.value, node),
      ImportExpression: (node) => check(node.source, node.source.value, node),
      TSImportType: (node) => check(node.source, node.source.value, node),
    };
  },
};
