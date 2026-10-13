import { builtinModules } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";

const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);

/** Colocated tests and the `*-test-harness` modules they share are test code; imports may omit the extension. */
export const testModule = /(?:\.test|-test-harness)(?:\.[cm]?[jt]sx?)?$/;

/** Resolve local dependencies before checking ownership; service/platform/panel is service code. */
export const sourceBoundaries = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      boundary:
        "{{owner}} source cannot import {{target}}. Use feature-owned shared contracts for cross-runtime data.",
    },
  },
  create(context) {
    const root = context.cwd;
    const filename = context.filename;
    const localFile = relative(root, filename).replaceAll("\\", "/");
    const owner = localFile.match(/^src\/(service|panel|shared)\//)?.[1];

    if (!owner || testModule.test(localFile)) return {};

    function check(node, value, declaration = node) {
      if (typeof value !== "string") return;
      let target;

      if (value.startsWith(".") || isAbsolute(value)) {
        const dependency = relative(
          root,
          resolve(filename, "..", value),
        ).replaceAll("\\", "/");

        target = testModule.test(dependency)
          ? "test code"
          : (dependency.match(/^src\/(service|panel|shared)\//)?.[1] ??
            dependency.match(/^(dev|tests)\//)?.[1]);
      } else if (value.startsWith("node:") || builtins.has(value)) {
        target = "Node built-ins";
      } else if (
        owner === "shared" &&
        /^(?:@anthropic-ai\/claude-agent-sdk|drizzle-orm)(?:\/|$)/.test(value)
      ) {
        if (
          value === "@anthropic-ai/claude-agent-sdk" &&
          filename
            .replaceAll("\\", "/")
            .endsWith("/src/shared/providers/claude/events.ts") &&
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

      if (
        !target ||
        target === owner ||
        target === "shared" ||
        (owner === "service" && target === "Node built-ins")
      ) {
        return;
      }

      context.report({ node, messageId: "boundary", data: { owner, target } });
    }

    return {
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
