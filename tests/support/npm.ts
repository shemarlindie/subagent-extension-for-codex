/**
 * The command and arguments that run npm. Under npm or npx, npm's own
 * script runs through this Node, since Windows can't start the npm.cmd shim
 * without a shell. scripts/assemble-release.mjs does the same.
 */
export function npmCommand(args: string[]): [string, string[]] {
  const cli = process.env.npm_execpath;

  return cli?.endsWith(".js")
    ? [process.execPath, [cli, ...args]]
    : ["npm", args];
}
