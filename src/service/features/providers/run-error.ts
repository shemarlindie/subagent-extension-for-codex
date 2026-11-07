/** A turn failure with a code and optional raw provider details. */
export class RunError extends Error {
  override name = "RunError";

  constructor(
    readonly code: string,
    details = "",
  ) {
    super(details);
  }
}
