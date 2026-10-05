export type Environment =
  | { kind: "preview" }
  | { kind: "host" }
  | { kind: "http"; origin: string }
  | { kind: "unsupported" };

type PageGlobals = Window & { CODEX_SUBAGENT_EXTENSION_ORIGIN?: string };

/** The server replaces this placeholder when it serves the page; the stdio resource keeps it. */
const PLACEHOLDER = "__API_ORIGIN__";

/**
 * Chooses the transport from where the page renders: an iframe talks to its host, a top-level
 * page served over HTTP talks to its origin, and a top-level page with neither has nothing to show.
 */
export function detectEnvironment(
  win: PageGlobals = window,
  search = win.location.search,
): Environment {
  if (win.parent !== win) return { kind: "host" };
  if (new URLSearchParams(search).get("preview") === "1")
    return { kind: "preview" };

  const origin = win.CODEX_SUBAGENT_EXTENSION_ORIGIN;
  if (origin && origin !== PLACEHOLDER) return { kind: "http", origin };

  return { kind: "unsupported" };
}
