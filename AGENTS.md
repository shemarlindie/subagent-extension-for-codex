# Agent instructions

## Verifying UI changes

Check in the browser when a change is large, when seeing it would help, or when the user asks. Skip small changes that tests cover.

- Preview fixtures (`ui/transports/preview-fixtures.ts`) cover every task status and activity row kind. Build events with the typed builder, not by hand; `tests/preview-sdk-fixtures.test.ts` replays them through the provider. Add a fixture for any new event or row kind.
- The `panel-dev` server (port 5317) is usually running. Navigate to `http://localhost:5317`; do not start or stop it.
- Set **Data** to `fixtures` and **Relaunch** (the iframe is blank for a few seconds). Use `live` data only for what fixtures cannot show: set **Launch** to `global`, and do not start tasks, since live mode performs real actions.
- Fixture tasks for specific cases:
  - **Refactor the billing module**: running (live status, running rows).
  - **Migrate the config loader**: pending question.
  - **Convert the test suite to the new runner**: exceeds the 200-event activity tail (trimmed timeline). Use it to test timeline scrolling, since most other timelines are short.
- The host's selects ignore `form_input`; set `.value` and dispatch `change`. **Width** sets narrow (360/480) or wide (Fill) layouts. At 360px the short frame stacks the inspector (the whole pane scrolls), so use 480 or Fill for the fixed-header layout.
- The panel is an iframe: query `document.querySelector('iframe').contentDocument` (`#tab-activity`, `.activity-group`, `.activity-debug-toggle`).
- Measure layout with `getBoundingClientRect` instead of judging by eye, and use `scrollIntoView` to move the timeline.
