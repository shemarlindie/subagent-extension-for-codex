// Code-quality lint only; formatting belongs to Prettier (eslint-config-prettier
// turns off conflicting rules).
import js from "@eslint/js";
import markdown from "@eslint/markdown";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

import { sourceBoundaries } from "./scripts/lint/source-boundaries.mjs";

// Code rules expect a JavaScript syntax tree, so they stay off Markdown.
const CODE = ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"];

const TESTS = ["tests/**/*.ts", "**/*.test.{ts,tsx}", "**/*-test-harness.ts"];

// Lower or remove these when files are refactored; don't raise them without a
// review rationale.
const SOURCE_FILE_LINE_CEILINGS = [
  ["src/panel/app/state/controller.ts", 1350],
  ["src/service/features/tasks/runtime/control.ts", 1000],
  ["dev/panel/host/host.tsx", 800],
  ["dev/panel/scenarios/activity-scenarios.ts", 575],
  ["dev/panel/scenarios/conversation-scenarios.ts", 450],
  ["dev/panel/scenarios/lifecycle-scenarios.ts", 575],
  ["dev/panel/scenarios/timeline.ts", 450],
  ["dev/panel/scenarios/tools.ts", 475],
];

export default defineConfig(
  { ignores: ["dist/", ".codex-subagent-extension/", "node_modules/"] },
  {
    files: CODE,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Best-effort cleanup and probing deliberately ignore failures.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-nested-ternary": "error",
    },
  },
  {
    // Type-aware rules. Each TypeScript file belongs to one of the three
    // tsconfigs; projectService would only find tsconfig.json by name.
    files: ["**/*.{ts,mts,cts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./tsconfig.panel.json",
          "./tsconfig.test.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    // A detached method loses `this` when called. Tests pass mocked methods
    // to `expect`, which never calls them.
    files: ["**/*.{ts,mts,cts,tsx}"],
    ignores: TESTS,
    rules: {
      "@typescript-eslint/unbound-method": "error",
    },
  },
  {
    // These ceilings block growth without requiring immediate refactors.
    files: ["src/**/*.{ts,tsx}", "dev/**/*.{ts,tsx}"],
    ignores: [...TESTS, "**/*.generated.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
      // Existing over-budget functions are counted in eslint-suppressions.json.
      complexity: ["error", 20],
    },
  },
  ...SOURCE_FILE_LINE_CEILINGS.map(([file, max]) => ({
    files: [file],
    rules: {
      "max-lines": ["error", { max, skipBlankLines: true, skipComments: true }],
    },
  })),
  {
    // Tests re-check values they built to fail with a clearer message, so
    // conditions are only checked in production and development code.
    files: ["**/*.{ts,mts,cts,tsx}"],
    ignores: TESTS,
    rules: { "@typescript-eslint/no-unnecessary-condition": "error" },
  },
  {
    // Blank-line layout is the one formatting concern Prettier leaves alone.
    files: CODE,
    plugins: {
      "@stylistic": stylistic,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      // Side-effect imports keep their order; then node: built-ins, packages,
      // and relative paths.
      "simple-import-sort/imports": [
        "error",
        {
          groups: [["^\\u0000"], ["^node:"], ["^@?\\w"], ["^"], ["^\\."]],
        },
      ],
      "simple-import-sort/exports": "error",
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        {
          blankLine: "always",
          prev: "*",
          next: [
            "function",
            "class",
            "interface",
            "type",
            "multiline-block-like",
            "multiline-export",
            "multiline-const",
            "multiline-expression",
          ],
        },
        {
          blankLine: "always",
          prev: [
            "function",
            "class",
            "interface",
            "type",
            "multiline-block-like",
            "multiline-export",
            "multiline-const",
            "multiline-expression",
          ],
          next: "*",
        },
        { blankLine: "always", prev: "*", next: "return" },
      ],
      // Methods and fields are separated, except consecutive single-line fields.
      "@stylistic/lines-between-class-members": [
        "error",
        "always",
        { exceptAfterSingleLine: true },
      ],
    },
  },
  {
    files: ["src/panel/**/*.{ts,tsx}", "dev/panel/host/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    // Classic hook rules only: the React Compiler rules misread
    // react-hook-form's field objects as refs, and the compiler is not used.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // One-expression handlers read as part of the markup; anything longer is
    // logic that belongs in a named function. Empty no-ops and one-expression
    // blocks, such as a ref callback's assignment, stay inline.
    files: ["src/panel/**/*.tsx", "dev/panel/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "JSXAttribute > JSXExpressionContainer > :function",
          // Also when chosen by a condition, as in `cond ? () => { … } : undefined`.
          "JSXAttribute > JSXExpressionContainer > :matches(ConditionalExpression, LogicalExpression) > :function",
        ].map((handler) => ({
          selector: `${handler} > BlockStatement:not([body.length=0]):not([body.length=1][body.0.type="ExpressionStatement"])`,
          message:
            "Move multi-statement handlers out of JSX into a named function.",
        })),
      ],
    },
  },
  {
    // Tests cast loosely typed protocol results and build partial fakes.
    files: TESTS,
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { project: { rules: { "source-boundaries": sourceBoundaries } } },
    rules: { "project/source-boundaries": "error" },
  },
  prettier,
  {
    // One-line statements may omit braces; anything spanning lines needs them,
    // and every branch of an if/else matches. Listed after the Prettier config,
    // which turns curly off; when Prettier wraps a long one-liner, eslint --fix
    // adds braces once and the result stays stable.
    files: CODE,
    rules: { curly: ["error", "multi-line", "consistent"] },
  },
  {
    // Docs: broken links and fragments, empty links, duplicate headings and
    // similar Markdown mistakes. GitHub-flavored for tables.
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
  },
);
