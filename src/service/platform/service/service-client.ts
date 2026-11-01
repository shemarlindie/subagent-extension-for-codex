/** Where the service listens and the token its API takes. */
export type ServiceConnection = { origin: string; token: string };

export type ServiceCall = {
  /** How long the call may take once connected, in milliseconds. */
  timeout: number;
  headers?: Record<string, string>;
  /** Whether sending the call twice is harmless. */
  readOnly?: boolean;
};

/**
 * Whether a failed call can be sent again on a new connection. A refused
 * connection never reached the service. A reset one may have, so only
 * read-only calls retry it.
 */
export function retryable(error: unknown, readOnly = false) {
  const code = (error as { cause?: { code?: string } }).cause?.code;

  return (
    code === "ECONNREFUSED" ||
    (readOnly && (code === "ECONNRESET" || code === "UND_ERR_SOCKET"))
  );
}

/**
 * The stdio proxy's link to the service. The connection starts on first
 * use, or early through `connect`, so the MCP handshake never waits for a
 * cold service start. A failed connection attempt is forgotten, and a call
 * that finds the service gone reconnects, starting a new service, and is
 * sent once more when that is safe.
 */
export function serviceClient(
  connect: () => Promise<ServiceConnection>,
  connectTimeout = 60000,
) {
  let current: Promise<ServiceConnection> | undefined;

  function connection() {
    const attempt = (current ??= connect());

    attempt.catch(() => {
      if (current === attempt) current = undefined;
    });

    return attempt;
  }

  /** The connection, or an error once a call has waited `connectTimeout` for it. */
  function connected(attempt: Promise<ServiceConnection>) {
    let timer: NodeJS.Timeout | undefined;

    return Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `The extension service did not start within ${connectTimeout / 1000} s`,
              ),
            ),
          connectTimeout,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Posts to `/api/<path>` with the service token. */
  async function post(
    path: string,
    body: unknown,
    call: ServiceCall,
    retry = true,
  ): Promise<Response> {
    const attempt = connection();
    const { origin, token } = await connected(attempt);

    try {
      return await fetch(`${origin}/api/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Subagent-Extension-For-Codex": "1",
          ...call.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(call.timeout),
        redirect: "error",
      });
    } catch (error) {
      if (!retry || !retryable(error, call.readOnly)) throw error;
      // Drop the stale connection, unless a concurrent call already replaced it.
      if (current === attempt) current = undefined;

      return post(path, body, call, false);
    }
  }

  return { connect: connection, post };
}
