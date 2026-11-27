# UI verification

Use this guide to check panel changes in a browser and in Codex, in both the
inline widget and the expanded panel.
[Local development](development.md#panel-dev-host) covers dev host setup, live
service connections and [fixture recording](development.md#recorded-fixtures).

## Workflow

1. Reuse the `panel-dev` server from `.claude/launch.json` (port 5317), or start
   `npm run dev:ui`. Start `service-dev` (port 17317) only for live data. Start
   or restart a server without asking, and tell the user when you do.
2. Open `http://127.0.0.1:5317`, set **Data** to **Fixtures**, and **Relaunch**.
   The iframe may stay blank briefly.
3. Check the relevant scenarios at narrow and wide widths, and in both themes
   when layout or styling changes. Check keyboard navigation, focus, loading,
   error and empty states when the change involves them.
4. Afterwards, use **Reset projects** and clear **Claude Code unavailable** and
   **Claude sign-in ending** if you changed them. Stop the servers you started,
   and leave others running.

Fixture mode makes no model calls and sends nothing to a real parent chat. Its
interactions still update fixture state and temporary Git repositories. Use live
data only for behavior fixtures cannot show. During a read-only live check,
select **Launch: Global** and do not start tasks.

To add fixtures, build events with the typed builder in
`dev/panel/scenarios/timeline.ts` or record them. Add a fixture for every new
activity row or event kind in its owning scenario module, and register it in
`dev/panel/scenarios/fixtures.ts`. `preview-sdk-fixtures.test.ts` replays built
and recorded fixtures through the provider.

## Screenshots

Capture the panel, never the whole dev host page. Screenshot the iframe element
for context or the changed element, such as a dialog or row, for detail. Use
both when the change is small within the panel. Use `deviceScaleFactor: 2` for
screenshots people will see. Add other widths or themes only where they look
different.

## Recordings

Run a scratch `.mts` script from the checkout with `npx tsx <script>.mts`.
Install Playwright Chromium and FFmpeg. For example, record a streamed reply
from the chat timeline:

```ts
import { withPanel } from "<checkout>/dev/panel/capture/panel-video";

await withPanel(
  "/?data=fixtures&display=fullscreen&dw_task=preview-live-conversation&dw_tab=chat",
  async ({ panel, record }) => {
    const reply = panel.locator("[data-streaming]");
    await reply.waitFor({ timeout: 60_000 });

    await record(
      "video-captures/chat.mp4",
      () => reply.waitFor({ state: "hidden", timeout: 60_000 }),
      {
        target: panel.locator(".chat-timeline"),
        output: { width: 960, height: 960 },
      },
    );
  },
  { panelSize: { width: 640, height: 720 }, scale: 1.5 },
);
```

- `withPanel` accepts `panelSize` and `viewport` in CSS pixels, plus `scale`
  (default 2). For clicks inside the zoomed iframe, use `center(locator)` with
  `page.mouse`.
- `record` defaults to the whole panel. A `target` is a locator resolved at the
  start or a rectangle in `page.mouse` coordinates. An exact `output` uses even
  dimensions and supports `contain` (default), `cover` or `stretch`. Resize the
  browser between MP4 recordings.
- For custom encoding, call `capturePngFrames(page, dir, actions)` from
  `dev/panel/capture/screencast.ts`. Use a fresh directory and one capture per
  Chromium instance. Feed its `frames.ffconcat` into FFmpeg with
  `-safe 0 -f concat -i <dir>/frames.ffconcat`.

### Comparison recordings

`withComparison` records one fixture scenario on several versions of the panel
and joins them side by side, each under a header with its label, an optional
note, a shared caption and live readouts. For example, compare a variant of one
file with the working tree:

```ts
import { withComparison } from "<checkout>/dev/panel/capture/comparison";

await withComparison({
  sides: [
    {
      label: "Before",
      note: "Native smooth scroll",
      color: "#b74331",
      source: {
        folder: "<scratch>/variants/before",
        paths: ["src/panel/features/tasks/evidence/end-follower.ts"],
      },
    },
    { label: "After", color: "#16825e" },
  ],
  path: "/?data=fixtures&display=fullscreen&dw_task=preview-live-fast-streaming&dw_tab=chat",
  clock: { startMs: 2000 },
  playMs: 7500,
  out: "video-captures/chat-scroll",
  caption: "Same reply · 1,500 characters per second",
  readouts: [
    {
      label: "Distance from latest",
      unit: "px",
      value: (panel) => {
        const history = panel.document.querySelector(
          '[aria-label="Chat history"]',
        );

        return history
          ? history.scrollHeight - history.clientHeight - history.scrollTop
          : 0;
      },
    },
  ],
  scenario: async ({ panel, play }) => {
    await panel.locator('[data-streaming="true"]').waitFor();
    await play();
  },
});
```

- A side's `source` sets the code it shows. Without one, it serves the working
  tree. Pick the source that isolates the change best, and say in the PR which
  you used:
  - **Swapped files**, `{ ref, paths }` or `{ folder, paths }`, put those files
    at a Git ref or from a folder into today's panel and fixtures. This suits a
    change in a few files whose imports still match. The run fails if the
    swapped files fail type checks or never load. The side is not a true old
    version of the app, so don't present it as one.
  - **Another checkout**, `{ checkout }`, serves a whole tree, such as one from
    `git worktree add --detach <scratch>/before <ref>` with `node_modules`
    linked from this checkout. This suits larger changes. The checkout needs the
    scenario's fixture and the fixture clock line in
    `dev/panel/scenarios/live-preview.ts`. Remove it afterwards with
    `git worktree remove`.
  - **A running dev host**, `{ origin }`, records any server you start. Its live
    fixtures run from page load on their own clock, so the sides can drift
    apart.

  For a style-only change, the scenario can make it on one side instead, such as
  by appending a style tag through `panel.locator("head")` before `play`. When
  none fits, use another approach that isolates the change, such as screenshots
  before and after an edit for a still comparison.

- `clock` holds the live fixtures at `startMs` until `play`, then runs them at
  `speed` (default 1) for `playMs`. Start just before the event under test, and
  slow the clock to stretch streaming while CSS animations keep their speed.
- `scenario` runs once per side. It waits for readiness, calls `play` with any
  actions, and can probe the side's `origin` afterwards.
- Each readout's `value` returns a number or text every animation frame. Numbers
  show rounded with `unit`, or through `format`. Both functions run in the page,
  so they can't use the script's variables. Headers grow to fit and share the
  tallest side's height.
- Sides are 640 × 900 by default. Set `size` to fit more, such as 480 wide for
  four sides.
- `out` gets `comparison.mp4` and `report.json`, with each side's source and
  commit, readout samples, frame check and page errors. A failed run still
  writes the report.

Record in your own worktree, since another session can switch a shared
checkout's branch. Take screenshots before or after `play`, and avoid other
heavy CPU or GPU work while recording. Init scripts you add run in both the host
page and the panel frame, so check `location.pathname` first. Before sharing a
video, extract a frame from the middle with
`ffmpeg -ss <seconds> -i comparison.mp4 -frames:v 1 frame.png` and check that
each side shows the expected behavior.

## Design review

Check the rendered panel against these points during the workflow above:

- The next step is obvious, and each state the workflow checks has a designed
  view, per
  [Loading and pending UI](panel-architecture.md#loading-and-pending-ui).
- Content doesn't jump as states change, per
  [Layout stability](panel-architecture.md#layout-stability). Fast shifts are
  easy to miss, so check with **Slow async reads** or a recording with delayed
  reads.
- Hierarchy, spacing, alignment and typography match nearby UI.
- Controls reuse [Shared controls](panel-architecture.md#shared-controls),
  icon-only controls have accessible names, and focus order and touch targets
  work.
- Text meets WCAG AA contrast (4.5:1 for body text, 3:1 for large text and UI
  components) in each host theme.

Compare before and after screenshots for visible changes. Where these docs are
silent, recommend a fix and leave the rules as they are.

## Scope and host controls

The dev host saves its settings in browser storage. Changing a setting
relaunches the panel. A link can also set **Data**, **Launch**, **Theme**,
**Display** and **Width** with the `data`, `launch`, `theme`, `display` and
`width` params, using the toolbar's values. Each load applies them and saves
them. With the panel's `dw_*` params, one link opens a view, such as
`/?display=fullscreen&launch=global&dw_task=<id>&dw_tab=chat`.

| Control                               | Use                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Launch**                            | **Thread** shows one conversation's tasks. **Global** shows every project and conversation. `dev-thread` has `/demo/project` and `/demo/website` tasks, `other-thread` owns two, and `projects-thread` fills `/demo/mobile` and `/demo/docs` to show long and short project groups. |
| **Theme**, **Display**, **Width**     | Width offers 360, 480, 760 and Fill. A short 360px frame can scroll the whole inspector, so use a taller or wider frame to check the fixed-header layout.                                                                                                                           |
| **Send messages**, **Update context** | Vary the host capabilities the panel sees.                                                                                                                                                                                                                                          |
| **File downloads**                    | Off, **Export file** takes the service save path, as it does in Codex.                                                                                                                                                                                                              |
| **Successful limit updates**          | Lets budget Apply, Continue prefill and the send-button tooltip succeed without a service.                                                                                                                                                                                          |
| **Slow async reads**                  | Delays fixture content reads, including the initial task list, so you can inspect loading placeholders. Writes and live mode are unaffected.                                                                                                                                        |
| **Inspector > Bridge log**            | Lists tool calls, message and context requests, file downloads and display-mode changes, including those made while the inspector was closed. `served` names the source that answered each call.                                                                                    |
| **Inspector > Host settings**         | Holds the controls below.                                                                                                                                                                                                                                                           |

Host settings:

- **Sandbox cwd** supplies the chat directory. The default is the checkout,
  which is not a fixture project and shows **Allow tasks here**. Enter
  `/demo/website` to open that project.
- **Automatically add chat projects** matches the user setting of that name.
- **Claude Code unavailable** shows readiness notices in the panel and the New
  task form.
- **Plan usage** sets the header meter's state: none, normal, close to the limit
  or limit reached.
- **Org policy (JSON)** applies a policy, in the shape discovery reports, to the
  composer's menus and Settings. **Insert example** fills in the fixture policy.
  Any policy comes with a saved mode it may outrank.
- **Added projects** lists projects you registered. They persist across reloads
  until **Reset projects**.
- **Host style variable overrides** takes JSON. See
  [Measurement and checks in Codex](#measurement-and-checks-in-codex).

## Fixture catalogue

| Task                                        | Scenario                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review recorded edits                       | Typed SDK tool results replay through the mapper. Covers added, modified, deleted, command and incomplete rows and the command warning in both scopes.                                                            |
| Refactor the billing module                 | Running task with recorded modified, added and deleted files, command tags, incomplete files and a command warning.                                                                                               |
| Live: …                                     | Latest activity and clocks for thinking, tool, compaction, retry, rate limit, ordinary work, finishing, hook, background task and provider failure.                                                               |
| Live: conversation cycle                    | Repeats a 32-second turn with thinking, two streamed replies, a long tool command, compaction and completion with a wrap-up question. The second reply uses rich Markdown. Reloads show up to three recent turns. |
| Live: streaming reply                       | Chat draft grows over time and restarts.                                                                                                                                                                          |
| Live: fast streaming reply                  | A long draft grows at 1,500 characters per second, for checking that pinned Chat follows smoothly.                                                                                                                |
| Recorded: …                                 | Real SDK runs: steer, interrupt and send now, streamed reply, question interrupted and resumed, read-only MCP review.                                                                                             |
| Review the session prompt change            | Request attachments of every kind: chips, overflow and expansion, each viewer, a text note labelled `.md` and a missing file. A parent follow-up with two attachments of its own.                                 |
| Limit upload sizes                          | Parent-started turns, user and parent follow-ups, Markdown lists, tables, code, footnotes, relative links and images, HTML-like prose. Recorded changes remain after later commits.                               |
| Tidy the settings copy                      | Taken and pending steers, and queued messages including one from the parent. New steers and queued messages stay until reload.                                                                                    |
| Rename the feature flags                    | Interrupted task with a paused queue: a leftover steer, then two messages to reorder, edit or remove until reload.                                                                                                |
| Move the date helpers                       | Cost limit reached. The warning notice applies a higher limit without sending a message.                                                                                                                          |
| Finish the date helper migration            | Runtime limit reached. The warning notice applies a higher runtime limit without sending a message.                                                                                                               |
| Move the screens to the new layout          | Long Chat conversation for scrolling.                                                                                                                                                                             |
| Clean up the upload retries                 | Org policy limited the mode: the note in Chat, effective values in run settings and Details.                                                                                                                      |
| Find legacy config readers                  | Org policy lowered the reasoning: the note in Chat and the effective level in run settings and Details.                                                                                                           |
| Map the upload retry paths                  | Prompt cache timer counts down from 2m 30s at load, through the warning under 2 minutes, to expired. Context usage at 25%.                                                                                        |
| Port the transcript reader                  | Context usage at 81%, in the warning color, close to auto-compact.                                                                                                                                                |
| Stabilise the retry timer test              | Worktree recreated from its branch in a new session.                                                                                                                                                              |
| Migrate the config loader                   | Pending inline question and queue-only composer. Queued messages stay until reload.                                                                                                                               |
| Plan the sign-in rollout                    | Three stacked questions, single and multiple choices, and queue-only composer.                                                                                                                                    |
| Investigate session expiry regression       | Pending permission request.                                                                                                                                                                                       |
| Convert the test suite to the new runner    | Trimmed timeline, scrolling, View activity for turns inside and outside the recent window, and custom instructions in Details.                                                                                    |
| Move the API clients onto the retry wrapper | Many turns, including a failure. View activity loads older turns separately and scrolls to recent ones.                                                                                                           |
| Catalogue the design assets                 | Thinking, images, documents, web search, plugin and memory signals.                                                                                                                                               |
| Tighten the task inspector layout           | Two committed turns, the **This turn** option, recorded changes and clean worktree removal.                                                                                                                       |
| Fix the flaky retry test                    | Failed run with a denied permission, a sync error and a session not fully saved. Removed worktree with its branch retained.                                                                                       |
| Monitor session health                      | Rare SDK signals: Claude notes, two quiet info lines and a warning.                                                                                                                                               |
| Draft the release notes                     | Removed worktree and deleted branch.                                                                                                                                                                              |
| Tidy the field notes                        | Folder without Git: the fallback notice, the Project folder reason in Details and the possibly unrecorded command note.                                                                                           |
| Outline the sketch                          | Repository with no commits: the fallback notice. **Field notes** and **Sketch** show their icons in **Manage projects…**, and adding a path with `no-git` in it adds a folder without Git.                        |
| Speed up the production build               | 60-file recorded diff, listed as 61 files because its rename shows as a deletion and an addition. Removal asks before discarding checkout changes.                                                                |
| Profile the production build                | Large added files and multiple pages of diff and file previews.                                                                                                                                                   |
| Plan: split billing                         | 3 of 7 steps done: the card, the row count and Plan rows in Activity.                                                                                                                                             |
| Plan: steered mid-step                      | Stale header after a taken steer.                                                                                                                                                                                 |
| Plan: finished                              | History row in Chat, with no card or row count.                                                                                                                                                                   |
| Plan: unfinished                            | History row with steps left.                                                                                                                                                                                      |
| Wrap-up: recap                              | Recap with no question.                                                                                                                                                                                           |
| Wrap-up: question                           | An answered turn's question without buttons, then the latest question with reply buttons.                                                                                                                         |
| Wrap-up: blocked                            | **Needs input** on the row and in the **Needs attention** filter.                                                                                                                                                 |

Read state:

- Audit dependency licences, Fix the flaky retry test, Migrate the config loader
  and Investigate session expiry regression start unread. Use them to check the
  row dot and the **Unread** filter.
- Move the screens to the new layout starts read through the middle, so Chat
  opens at its **New** divider partway down.
- The other fixtures start read. Read marks reset when the preview reloads.

Changes fixtures in `dev/panel/scenarios/change-fixtures.ts` replay recorded
edits into real temporary Git repositories for file previews and worktree
actions. Worktree actions change these repositories. A Vite restart or a service
source edit rebuilds them. To get fresh state without restarting a shared dev
host, start another with `npx vite --port <port> --strictPort`. `large-files.ts`
supplies the 60-file diff, minified JSON, a large CSV, a log file, long Markdown
with heading links, a single long line and an oversized SVG that displays as
source.

## Measurement and checks in Codex

### Browser measurement

The panel runs in an iframe. Inspect its `contentDocument` when the browser tool
supports DOM inspection.

- If the tool's form input does not change a host select, set `.value` and
  dispatch `change`.
- Use `getBoundingClientRect` for layout and `scrollIntoView` for long feeds.
- Hidden panes throttle frames. To inspect an exact animation state, pause
  `element.getAnimations()` and set `currentTime`.

### Host styles

The dev host sends no style variables by default. Enter JSON in **Host style
variable overrides** to test them. `dev/panel/host/host-styles-light.json` and
`host-styles-dark.json` hold captures from Codex desktop's MCP App context for
reference. The panel drops style keys the installed SDK does not recognize, so
new host keys do not break initialization.

### Checks in Codex

The dev host does not reproduce Codex's iframe sandbox, CSP or placement.
Automated tests and fixture screenshots cannot show message delivery or
placement in Codex. For changes that affect the panel in Codex, build and open
an approved repository in Codex, then check:

| Change            | Check                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Any panel change  | Scope and New task prefills, without submitting. Then reopen an existing task.                                                              |
| Entrypoints       | The sidebar entrypoint and switching between inline and expanded.                                                                           |
| Folder browsing   | On macOS, **Browse** and cancel leaves the selection unchanged. Choosing a valid Git root registers and selects it without starting a task. |
| Scope             | Two chats with different projects stay separate.                                                                                            |
| Composer mentions | Temporarily disabled.                                                                                                                       |
