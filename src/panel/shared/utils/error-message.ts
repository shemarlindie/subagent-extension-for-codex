/** A failure's message, for showing to the user. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
