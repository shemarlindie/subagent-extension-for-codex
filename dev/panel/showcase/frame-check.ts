// Counts frames Chromium presented during a capture that the screencast missed.
// A trace lists every presented compositor frame. A user timing mark that holds
// the wall clock ties trace time to screencast timestamps.
import type { CDPSession, Page } from "@playwright/test";

export type TraceEvent = {
  name: string;
  ph: string;
  ts: number;
  pid: number;
  id2?: { local?: string };
  args?: { frame_reporter?: { state?: string } };
};

type FrameCheck = {
  presented: number;
  brief: number;
  captured: number;
  missed: number[];
  partial: number;
  dropped: number;
};

export const SYNC = "frame-check-sync";
const REFRESH_MS = 1000 / 60;

export async function startFrameCheck(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];

  cdp.on("Tracing.dataCollected", ({ value }) => {
    // The protocol types trace events as string maps.
    events.push(...(value as unknown as TraceEvent[]));
  });

  await cdp.send("Tracing.start", {
    traceConfig: {
      includedCategories: [
        "disabled-by-default-devtools.timeline.frame",
        "blink.user_timing",
      ],
    },
    transferMode: "ReportEvents",
  });

  const wall = await page.evaluate((name) => {
    const now = performance.now();
    performance.mark(name, { startTime: now });

    return performance.timeOrigin + now;
  }, SYNC);

  // Takes the screencast frame timestamps, in wall-clock milliseconds.
  return async (shots: number[]) => {
    await endTrace(cdp);
    await cdp.detach();

    return checkFrames(events, wall, shots);
  };
}

async function endTrace(cdp: CDPSession) {
  const complete = new Promise((resolve) => {
    cdp.once("Tracing.tracingComplete", resolve);
  });

  await cdp.send("Tracing.end");
  await complete;
}

export function checkFrames(
  events: TraceEvent[],
  wall: number,
  shots: number[],
) {
  const mark = events.find((event) => event.name === SYNC);

  if (!mark || shots.length === 0) {
    throw new Error("Frame check found no sync mark or no captured frames");
  }

  const toWall = (ts: number) => ts / 1000 - mark.ts / 1000 + wall;
  const first = shots[0]!;
  const last = shots.at(-1)!;
  const inWindow = (time: number) => time >= first - 4 && time <= last + 4;

  const reports = pipelineReports(events, mark.pid).filter(({ end }) =>
    inWindow(toWall(end)),
  );

  // A presented frame can finish a slow main-thread update alongside the
  // compositor's own, so reports that share a presentation are one frame.
  const latestBegin = new Map<number, number>();

  for (const { begin, end, state } of reports) {
    if (state.startsWith("STATE_PRESENTED")) {
      latestBegin.set(end, Math.max(latestBegin.get(end) ?? 0, begin));
    }
  }

  const presented = [...latestBegin]
    .map(([end, begin]) => ({ end: toWall(end), begin: toWall(begin) }))
    .sort((a, b) => a.end - b.end);

  // A late frame replaced within half a refresh rarely reaches a 60 Hz
  // display, and normal frames last a full refresh give or take jitter.
  // Frames that began before the first shot can't be judged.
  const lasting = presented.filter(
    ({ begin, end }, index) =>
      (presented[index + 1]?.end ?? Infinity) - end >= REFRESH_MS / 2 &&
      begin >= first - 4,
  );

  // The screencast stamps a frame with its begin time, or the next refresh's
  // when the copy finishes late. Matches in order within that range.
  const missed: number[] = [];
  let shot = 0;

  for (const { begin } of lasting) {
    while (shot < shots.length && shots[shot]! < begin - 4) {
      shot++;
    }

    if (shot < shots.length && shots[shot]! <= begin + REFRESH_MS + 4) {
      shot++;
    } else {
      missed.push(begin - first);
    }
  }

  const count = (state: string) =>
    reports.filter((report) => report.state === state).length;

  return {
    presented: lasting.length,
    brief: presented.length - lasting.length,
    captured: shots.length,
    missed,
    partial: count("STATE_PRESENTED_PARTIAL"),
    dropped: count("STATE_DROPPED"),
  } satisfies FrameCheck;
}

// Pairs each of the page renderer's PipelineReporter begins with the next end
// of the same id, since ids repeat.
function pipelineReports(events: TraceEvent[], pid: number) {
  const open = new Map<string, TraceEvent>();
  const reports: { begin: number; end: number; state: string }[] = [];

  for (const event of events
    .filter((event) => event.name === "PipelineReporter" && event.pid === pid)
    .sort((a, b) => a.ts - b.ts)) {
    const id = event.id2?.local ?? "";
    const begin = open.get(id);

    if (event.ph === "b") {
      open.set(id, event);
    } else if (event.ph === "e" && begin) {
      open.delete(id);

      reports.push({
        begin: begin.ts,
        end: event.ts,
        state: begin.args?.frame_reporter?.state ?? "",
      });
    }
  }

  return reports;
}

export function describeFrameCheck(check: FrameCheck) {
  const gaps = check.missed
    .slice(0, 8)
    .map((ms) => `${(ms / 1000).toFixed(2)}s`)
    .join(", ");

  return [
    `${check.presented} presented, ${check.captured} captured, ${check.missed.length} missed`,
    check.missed.length > 0
      ? `Misses at ${gaps}${check.missed.length > 8 ? ", ..." : ""}`
      : undefined,
    `Rendering: ${check.brief} brief, ${check.partial} partial, ${check.dropped} dropped`,
  ]
    .filter(Boolean)
    .join(". ");
}
