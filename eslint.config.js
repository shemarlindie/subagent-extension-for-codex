// Markdown lint only. Oxlint lints JavaScript and TypeScript.
import markdown from "@eslint/markdown";
import { defineConfig } from "eslint/config";

export default defineConfig(
  {
    ignores: [
      ".claude/worktrees/",
      "dist/",
      "release/",
      ".subagent-extension-for-codex/",
      "node_modules/",
      "test-results/",
      "playwright-report/",
      "showcase-captures/",
    ],
  },
  {
    // Docs: broken links and fragments, empty links, duplicate headings and
    // similar Markdown mistakes. GitHub-flavored for tables.
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
    rules: {
      // GitHub alerts such as `> [!NOTE]` look like missing label references.
      "markdown/no-missing-label-refs": [
        "error",
        {
          allowLabels: ["!NOTE", "!TIP", "!IMPORTANT", "!WARNING", "!CAUTION"],
        },
      ],
    },
  },
);
