# Browser flows

These Playwright flows drive the built console against a disposable service.
[Checks](../../docs/development.md#browser-flows) covers running them and
inspecting failures, and
[Choosing test coverage](../../docs/development.md#choosing-test-coverage)
covers when to add one.

## State setup

- One flow covers login and explicit project registration in full. Other flows
  log in and register through the public HTTP endpoints, sharing cookies with
  their fresh browser context.
- Reloads establish persistence. Playwright routing drops responses, and closing
  the service's open connections drops the event stream.
- Most services run inside their Playwright worker process. The recovery flow
  runs the development fixture service as a separate process, crashes it and
  reopens the same data directory on the same port.
- Suites configure the fixture worker with `test.use({ fixtureProvider })`, for
  example to fail provider session deletion.
- Default browser fixtures skip incidental thinking and reply pacing. Explicit
  scenario timing markers still apply. `streaming-fixtures.ts` holds reply chunks
  while the browser checks partial content, then releases the next chunk through
  real SSE delivery. Use these checkpoints when a test needs an observable stream.
- Functional flows use reduced motion. The streaming, caret, conversation-cycle,
  arrival and Changes navigator suites explicitly enable animations to verify
  their geometry and transitions.
- Geometry baselines wait for finite animations to finish and compare samples
  taken an interval apart. Reduced motion shortens entrances such as the narrow
  task slide, but each one holds its first keyframe until the browser renders a
  frame, which a busy runner can delay.

## Performance

Measure performance with the same build and trace settings. Run
`npx playwright test --workers=1 --reporter=json` to see serial costs, then
compare the default worker count. Add `--repeat-each=3` to check repeatability
and isolation. The JSON report records total and per-test durations, and trace
hooks separate setup from the flow. Keep condition-based assertions and failure
diagnostics when optimizing.

For the full pipeline, compare `npm test` from the same checkout with the same
Node version, available CPUs and browser installation. It overlaps static checks
with the build and tests, and runs browser flows before Vitest. Measure focused suites
separately from full runs so competing processes do not skew the comparison.

## Coverage limits

Spec files are named for their feature area, and test names state the behavior
each flow verifies. List them with `npx playwright test --list`. The flows have
these limits:

- Focused component tests own large file previews, clipboard handoff and theme
  presentation.
- `tests/integration/service/` owns launcher and package lifecycle details.
- Browser flows run desktop Chromium only.
- The fake worker establishes extension routing and persistence. It does not
  establish native Claude permissions, live Codex placement or host message
  delivery. Use [UI verification](../../docs/ui-verification.md) and
  [Claude execution verification](../../docs/claude-verification.md) for those.
