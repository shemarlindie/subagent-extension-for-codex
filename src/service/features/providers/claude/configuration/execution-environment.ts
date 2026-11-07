/** Delegated sessions never receive the extension's own variables or the OpenAI variables Codex may pass. */
const privateVariable = (name: string) =>
  name.startsWith("SUBAGENT_EXTENSION_FOR_CODEX_") ||
  name.startsWith("OPENAI_");

/** The service environment for Claude Code, without private variables. */
export function claudeEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([name, value]) => value !== undefined && !privateVariable(name),
      ),
    ),
    // A refusal otherwise ends with stderr alone, without its reason code.
    CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1",
  };
}
