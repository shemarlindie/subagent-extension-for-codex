import { expect, test } from "vitest";

import { checkFrames, SYNC, type TraceEvent } from "./frame-check";

// Trace time starts at the sync mark, and wall time at 0, so both use the same
// milliseconds.
const mark: TraceEvent = { name: SYNC, ph: "R", ts: 0, pid: 1 };

function frame(
  id: number,
  begin: number,
  end: number,
  state = "STATE_PRESENTED_ALL",
): TraceEvent[] {
  const event = { name: "PipelineReporter", pid: 1, id2: { local: `${id}` } };

  return [
    {
      ...event,
      ph: "b",
      ts: begin * 1000,
      args: { frame_reporter: { state } },
    },
    { ...event, ph: "e", ts: end * 1000 },
  ];
}

test("matches late stamps and reports that share a presentation", () => {
  const events = [
    mark,
    ...frame(1, 0, 6),
    // A slow main-thread update presented with the compositor's next frame.
    ...frame(2, 16.7, 40),
    ...frame(3, 33.3, 40),
    ...frame(4, 66.7, 70),
  ];

  // The merged frame's copy finished late, so it has the next refresh's stamp.
  const check = checkFrames(events, 0, [0, 50, 66.7]);

  expect(check).toMatchObject({ presented: 3, brief: 0, missed: [] });
});

test("reports lasting frames without a shot, but not brief ones", () => {
  const events = [
    mark,
    ...frame(1, 0, 6),
    // Replaced 4 ms later, so a 60 Hz display rarely shows it.
    ...frame(2, 16.7, 22),
    ...frame(3, 20, 26),
    ...frame(4, 33, 40),
    ...frame(5, 66.7, 70),
    ...frame(6, 66.7, 70, "STATE_DROPPED"),
  ];

  const check = checkFrames(events, 0, [0, 20, 66.7]);

  expect(check).toMatchObject({
    presented: 4,
    brief: 1,
    missed: [33],
    dropped: 1,
  });
});
