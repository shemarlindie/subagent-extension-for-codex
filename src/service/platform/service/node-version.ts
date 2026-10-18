/**
 * Why this Node.js can't run the service, or undefined when it can. The
 * build compiles this check into each public entry for old runtimes, so an
 * unsupported Node prints this message and exits before loading code it
 * can't parse.
 */
export function nodeVersionError(
  version: string,
  executable: string,
  minimum: number,
) {
  if (Number(version.split(".")[0]) >= minimum) return;

  return (
    `codex-subagent-extension needs Node.js ${minimum} or later, but ${executable} is Node.js ${version}.\n` +
    `Install Node.js ${minimum} or later from https://nodejs.org and make sure it is first on the PATH Codex uses.`
  );
}
