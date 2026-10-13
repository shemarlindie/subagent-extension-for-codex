// DEBUG: Temporary panel sizing trace. Remove this module and its call sites after diagnosis.
type SizeTraceEntry = {
  event: string;
  elapsedMs: number;
  timestamp: string;
  viewport: { width: number; height: number };
  bodyHeight: number;
  previewHeight: number | null;
  expanded: string | undefined;
  details: Record<string, unknown>;
};

declare global {
  interface Window {
    CODEX_SUBAGENT_SIZE_TRACE?: SizeTraceEntry[];
  }
}

/** Temporary startup diagnostics; keep only dimensions and lifecycle metadata. */
export function traceSize(
  event: string,
  details: Record<string, unknown> = {},
) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const now = performance.now();

  const entry: SizeTraceEntry = {
    event,
    elapsedMs: Math.round(now * 100) / 100,
    timestamp: new Date(performance.timeOrigin + now).toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyHeight: document.body.getBoundingClientRect().height,
    previewHeight:
      document.querySelector(".inline-preview")?.getBoundingClientRect()
        .height ?? null,
    expanded: document.body.dataset.expandedPanel,
    details,
  };

  const entries = (window.CODEX_SUBAGENT_SIZE_TRACE ??= []);
  entries.push(entry);
  if (entries.length > 200) entries.shift();
  console.info("[delegated-work:size]", JSON.stringify(entry));
}
