/**
 * The command a message runs, such as `compact` for `/compact focus on tests`.
 * A message that starts with a path, such as `/tmp/notes.txt is broken`, runs
 * none.
 */
export function slashCommand(message: string) {
  return /^\/([A-Za-z0-9][\w:.-]*)(?:\s|$)/.exec(message)?.[1];
}
