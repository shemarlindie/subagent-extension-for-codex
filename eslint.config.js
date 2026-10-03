// Code-quality lint only; formatting belongs to Prettier (eslint-config-prettier
// turns off conflicting rules).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";

export default tseslint.config(
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
    files: ["ui/**/*.{ts,tsx}"],
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
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  prettier,
);
