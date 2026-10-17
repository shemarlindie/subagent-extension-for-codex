/** The service confirmed that this send did not commit an acceptance receipt. */
export class SendRejectedError extends Error {
  override name = "SendRejectedError";
}
