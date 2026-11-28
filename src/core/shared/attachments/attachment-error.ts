/** A start or read the caller can fix, such as a path outside the project. */
export class AttachmentError extends Error {
  override name = "AttachmentError";
}
