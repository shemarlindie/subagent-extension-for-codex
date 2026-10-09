// Code-quality lint only; formatting belongs to Prettier (eslint-config-prettier
// turns off conflicting rules).
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

import { sourceBoundaries } from "./scripts/lint/source-boundaries.mjs";

export default defineConfig(
  { ignores: ["dist/", ".codex-subagent-extension/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
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
    },
  },
  {
    // Blank-line layout is the one formatting concern Prettier leaves alone.
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
    // Tests cast loosely typed protocol results and build partial fakes.
    files: [
      "tests/**/*.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "dev/**/*.test.ts",
      "dev/**/*.test.tsx",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { project: { rules: { "source-boundaries": sourceBoundaries } } },
    rules: { "project/source-boundaries": "error" },
  },
  prettier,
);
