/** Static categories retain useful failure reasons without copying SDK messages or payloads. */
export function errorCategory(error: unknown) {
  if (!(error instanceof Error)) return "unknown";
  const message = error.message.toLowerCase();
  const status = "status" in error ? error.status : undefined;

  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|authentication|invalid.*(?:token|api.?key)|missing.*(?:token|api.?key)|not logged in/.test(
      message,
    )
  ) {
    return "authentication";
  }

  if (status === 429 || /rate.?limit|too many requests/.test(message)) {
    return "rate_limit";
  }

  if (error.name === "AbortError") return "aborted";

  if (error.name === "TimeoutError" || /timed? ?out|timeout/.test(message)) {
    return "timeout";
  }

  if (/econnrefused|econnreset|enotfound|fetch failed|network/.test(message)) {
    return "connection";
  }

  if (/budget.*exhausted|maximum.*budget/.test(message)) return "budget";

  return "unknown";
}
