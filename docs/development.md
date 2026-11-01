# Local development

Use this guide to build, run, change and check the project from a checkout.

- [Architecture](architecture.md) covers code ownership and runtime boundaries.
- [UI verification](ui-verification.md) covers browser and Codex checks of the
  panel.
- [Database and migrations](database.md) covers schema changes, transactions
  and event notifications.
- [Claude execution verification](claude-verification.md) covers CLI and SDK
  qualification and opt-in authenticated scenarios.

Run every command from the project root. You need Node.js 24 or later and Git.

## Setup

```sh
npm ci
cp -n .env.example .env
```

`npm run dev`, `npm start`, `npm run projects`, `npm run dev:reset` and
`npm run dev:ui` load `.env`
when present. Shell variables take precedence. `.env` is gitignored, and the
example keeps data in `.subagent-extension-for-codex/live`. See the
[configuration table](configuration.md#environment-variables) for every
variable.

The service and panel dev host must use the same
`SUBAGENT_EXTENSION_FOR_CODEX_DATA`, which holds the database and admin token. How
Codex finds that directory depends on the
[transport](#connect-codex-from-a-checkout):

- **Stdio.** The Codex-launched proxy needs the same path, made absolute, in its
  MCP environment for service discovery:

  ```toml
  [mcp_servers.subagent_extension_for_codex.env]
  SUBAGENT_EXTENSION_FOR_CODEX_DATA = "<checkout-root>/.subagent-extension-for-codex/live"
  ```

- **HTTP.** Configure the [Streamable HTTP](#streamable-http) URL and an
  Authorization header with the token from
  `<checkout-root>/.subagent-extension-for-codex/live/admin-token`, or the service's
  token override. Codex needs no data directory setting.

If the plugin is installed too, give the checkout its own `PORT`, such as
`17318`, in `.env` and the MCP environment. Otherwise the plugin's proxy finds
the checkout's service on port 17317, and a plugin update can
[hand over](task-continuation.md#updates-and-service-handoff) a checkout service
that a stdio proxy started.

With **Automatically add chat projects** on (the default), starting a task from
a chat registers its project. Use **Manage → Add project** or `npm run projects`
to register others. See [Repository access](configuration.md#repository-access).

## Generated validation schemas

Pick the validation source by what the contract owns:

| Contract                                                                                                                                        | Source                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain boundary data, such as settings documents, panel output and event payloads                                                                | TypeScript types with generated Zod schemas. Edit the source types and regenerate.                                                                       |
| Inputs with transformations, defaults or substantial validation, such as task start, tool inputs, settings updates, stored tasks and SDK inputs | Handwritten Zod with inferred TypeScript types.                                                                                                          |
| Database rows                                                                                                                                   | Validators derived from Drizzle tables at deserialization. Serialized JSON needs its own payload validation. See [Database and migrations](database.md). |
| Internal data that needs no runtime validation                                                                                                  | Plain TypeScript.                                                                                                                                        |

The generator discovers `src/**/*-contract.ts`, excluding generated files and
`*-contract.test.ts`. Contracts need no central registration, and imports
between them resolve to their generated validators. Schema generation never
changes migrations.

JSDoc supplies rules that plain types cannot express. Supported annotations
include `@strict` to reject extra properties, `@format url` and `@default` for
omitted input values. Contracts describe parsed output, so a default can make an
input property optional even when the output requires it.

To add a contract:

1. Put exported types in a feature-owned file such as
   `src/service/features/<feature>/message-contract.ts`:

   ```ts
   /** @strict */
   export interface Message {
     body: string;
   }
   ```

2. Run `npm run schemas:generate`. This creates the adjacent
   `message-contract.generated.ts`, which exports `messageSchema`.
3. Call the generated validator at the boundary and use the source type
   internally:

   ```ts
   import { messageSchema } from "./message-contract.generated.js";
   import type { Message } from "./message-contract.js";

   export function decodeMessage(input: unknown): Message {
     return messageSchema.parse(input);
   }
   ```

4. Add focused tests beside the contract for accepted and rejected data and any
   annotation behavior. Run `npm run typecheck`.

Commit the source, generated file and tests together.

A contract can import types only from other contracts. A type from anywhere
else would generate a permissive `z.any()`, so the generator rejects it. Data
built from handwritten schemas belongs in handwritten Zod, as Claude task
options do in `src/shared/providers/claude/task-options.ts`. Do not feed Drizzle
inferred types into this generator.

## Run the service

Build before starting either mode, including when testing in Codex:

| Use           | Command                        | Backend behavior                                                                                     |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Development   | `npm run build && npm run dev` | Runs `src/service/main.ts` through `tsx` in Node's watch mode. Restarts when backend sources change. |
| Built service | `npm run build && npm start`   | Runs `dist/main.js`. Rebuild and restart to apply backend changes.                                   |

Both modes run in the foreground at `http://127.0.0.1:17317` and serve the
embedded panel and standalone console from `dist/app.html`. `npm run dev` does
not rebuild the panel, so follow [What reloads when](#what-reloads-when) after
edits. Use the [panel dev host](#panel-dev-host) for UI work with Fast Refresh.

Stop the service with Ctrl-C. A restart interrupts active tasks. Send a
follow-up after the service returns to continue them.

Only one service can own a data directory. If Codex is open with the plugin
enabled, its stdio proxy may already have started one. On macOS and Linux, an
interactive start shows the owner's process details and asks before sending it
SIGTERM. If it is still running after five seconds, a second prompt offers
SIGKILL. Non-interactive starts and Windows never stop other processes.

Check the service from another terminal:

```sh
curl --fail http://127.0.0.1:17317/health
npm run projects -- list
```

Open the standalone console at `http://127.0.0.1:17317` and sign in with the
contents of `<data-directory>/admin-token`. On macOS,
`pbcopy < .subagent-extension-for-codex/live/admin-token` copies it. Use the
configured origin. `localhost` and `127.0.0.1` are different browser origins,
and the service's origin checks can reject the substitute.

### Reset service data

`npm run dev:reset` asks for confirmation, clears the configured data directory
and restarts the service only if it was running. The replacement uses the current
build in the background and logs to `<data-directory>/service.log`. On Windows,
stop the service manually first.

## Choosing a development tool

| Command          | Use for                                                     | Worker                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `npm run dev:ui` | UI development, prepared scenarios and host/layout controls | Prepared fixtures, or a connected backend in live mode |
| `npm run demo`   | Interactive service testing with disposable data            | Fake worker with no model calls                        |
| `npm run dev`    | Backend development and Claude execution                    | Claude model calls, which can incur costs              |

In the dev host, **Data: live** connects to a running service, whose worker may
be fake or Claude. [Demo](#demo) shows how to pair the dev host with the fake
worker.

## Panel dev host

```sh
npm run dev:ui
```

This starts Vite at `http://127.0.0.1:5317` with React Fast Refresh and CSS hot
replacement. The page embeds the real panel in an iframe through the official
`AppBridge`, and lets you vary launch scope, theme, display mode, width and host
capabilities. Production HTML comes from `scripts/build-panel.mjs`.
[UI verification](ui-verification.md) covers the workflow, host controls,
fixture catalogue and style variables.

**Data: fixtures** checks the UI without a production service. Prepared fixtures
cannot start provider tasks, but supported Chat interactions update simulated
state. Fixtures live in `dev/panel/scenarios/` and stay out of the production
bundle. Most tool calls use browser fixtures. Changes and worktree calls listed
in `FIXTURE_SERVICE_TOOLS` run real service code on Vite against disposable
repositories. The fixture service creates each task's repository and recorded
edits on its first call for that task. Source edits reset this state.

**Data: live** connects to the service's `/mcp` endpoint through the Vite proxy
at `/service`. The proxy adds the admin token server-side and drops the browser
`Origin` header, so the token never reaches the page.

- The proxy finds the service from `SUBAGENT_EXTENSION_FOR_CODEX_URL`, then
  `SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN`, then the data directory's `service.json`,
  then port 17317. It ignores `PORT`, which sets the dev host's own port in this
  process.
- It reads the token from `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN` or the data
  directory's `admin-token`.
- Start the service first, and restart Vite after the service changes ports.

For Claude execution against throwaway data, give both processes the same data
directory. The dev host reads the service's port from `service.json`:

```sh
SUBAGENT_EXTENSION_FOR_CODEX_DATA=/tmp/panel-dev PORT=4399 npm run dev
SUBAGENT_EXTENSION_FOR_CODEX_DATA=/tmp/panel-dev npm run dev:ui
```

### Access from your local network

Both commands listen on loopback only. Pass `--host` to listen on network
interfaces:

```sh
npm run dev -- --host
npm run dev:ui -- --host
```

On another computer, open `http://<service-computer-LAN-IP>:5317` for the dev UI
or `http://<service-computer-LAN-IP>:17317` for the standalone console.

- The service binds all IPv4 interfaces and prints its network URLs at startup.
- The console still requires the admin token. It accepts LAN origins from the
  interface addresses found at startup, so restart after those change.
- Codex and the dev UI proxy still connect through loopback. For dev UI live
  mode alone, only `dev:ui` needs `--host`.

The dev UI proxy adds the admin token, so anyone who can reach the dev UI can
control the service in live mode. Use these flags only on a trusted local
network. Firewall rules decide which computers can connect. Public and
multi-user hosting are out of scope.

## Recorded fixtures

The dev host has two kinds of task fixtures:

- Synthetic fixtures built with `dev/panel/scenarios/timeline.ts`.
- Tasks recorded from real Claude runs in `dev/panel/recorded/`, which preserve
  their SDK messages.

`dev/panel/scenarios/fixtures.ts` assembles both into the registry the dev host
and replay tests use. `dev/panel/scenarios/preview-sdk-fixtures.test.ts` replays
both through the provider.

Record a task from any service database, such as the service's, the demo's or a
temporary one from `scripts/verify-live-claude.mjs`:

```bash
npm run fixture:record -- --db <tasks.sqlite> --task <task id> --name <name> --title "Recorded: <what it shows>" --start 2026-10-02T11:40:00.000Z --first-id 3400
```

This writes `dev/panel/recorded/<name>.json` for task `preview-recorded-<name>`
in the `dev-thread` thread and `/demo/project` project. Import the file in
`fixtures.ts` and add it to `recordedFixtures`.

- Choose a `--first-id` past other fixtures' event IDs. Recorded fixtures start
  at 3000, a hundred apart.
- Choose a `--start` that places the task where you want it in the
  newest-first list.

The recorder replaces machine paths and identifiers, including the local
username in URLs and plugin names. It replaces SDK thinking signatures and
streamed signature deltas with placeholders, removes local Claude configuration
and private usage details, and shifts event IDs and times.
Replay maps recorded `tool_use_result` payloads through `claudeFileEdits`, so
captured edits populate Changes. File previews still need a fixture workspace or
prepared content.

Review the output before committing, because prompts and file contents can still
hold private information. The recorder rejects common machine identifiers, but
that check cannot prove the recording is safe to share. Add literal
replacements with repeatable `--replace <from>=<to>` arguments, quoting values
with spaces or shell characters, such as `--replace 'internal-name=/demo/name'`.

## Showcase captures

The showcase plays a short, curated collaboration for promotional images and
recordings. A Codex-like thread sits beside the real panel, which runs from the
dev server through the same bridge as the dev host, so panel changes appear
without extra work.

With `npm run dev:ui` running, open `http://127.0.0.1:5317/showcase.html`. The
URL picks the frame:

- `step` is the 0-based story step. The default is the second-to-last.
- `theme` is `dark` (default) or `light`.
- `capture` hides the controls.
- `play` loops the whole story instead of showing one step. Codex's items
  appear one at a time, and Codex opens the panel inline in its thread before
  expanding it into the side pane. Claude's replies stream, and the panel
  updates in place, as in a live run. The Play button toggles it.

Export every step in both themes at 1600×1000 and 2x scale:

```sh
npm run showcase:capture
```

It writes to `showcase-captures/`. Use `--out <dir>` for another folder, for
example to compare a version without replacing the standard captures, and
`--scale <n>` for another pixel ratio. Captures default to `--zoom 1.4`, which
enlarges the page by 40% within the same export size. Use `--zoom 1` for the
original page size, or another positive multiplier to tune readability.

Chromium records video in CSS pixels and ignores the device scale, so
screenshots, video and frames all open a viewport at the export size and apply
CSS `zoom` of scale × zoom. Stills then match video frames. Panel animations
that measure elements must divide by `currentCSSZoom`, as `autoListEffects`
does.

### Video and frame captures

Add `--video` to record one playback loop per theme as WebM in place of stills.
Video defaults to 60 fps at 3200×2000. Use `--fps <n>` for another frame rate
and `--scale 1` for a 1600×1000 export. Higher scales and frame rates take more
resources and produce larger files. The command reuses a running dev server or
starts one.

Add `--frames` to capture one playback loop per theme as lossless PNG frames,
for the GIF or the MP4. Playwright's screencast only delivers JPEG frames, so
this mode asks Chromium for PNG frames directly. Chromium sends a frame only
when the page changes, so each `showcase-<theme>-frames/` folder includes a
`frames.ffconcat` list that holds each frame until the next one. The list sets
each frame's time base to 1 ms, since ffmpeg's default of 1/25 s would cap
motion at 25 fps. That option needs `-safe 0`.

Video and frame captures record in real time, so frames can be lost two ways.
The screencast can skip frames when encoding falls behind, and the page can miss
frames when rendering is slow. Each capture traces the frames Chromium presents
and prints how many the screencast `missed`, with their playback times. It also
prints rendering counts. `partial` and `dropped` frames were late to the
screen, and `brief` frames were replaced within half a refresh, so a 60 Hz
display rarely shows them and they don't count as missed.

Captures launch Chromium with Metal GPU rendering, since headless Chromium
otherwise draws on the CPU. Metal exists only on macOS, and captures on other
platforms are untested. Captures also play the story once unrecorded so a fresh
browser's first-run work doesn't land in the first theme. Counts still vary
between runs. Close busy apps, capture a few times into separate `--out`
folders and keep the run with the fewest missed and dropped frames for each
theme. On an Apple M5 Pro at 2x, the best of a few runs has 0 missed and 2 to 4
dropped frames.

### MP4

Each MP4 and GIF in the README has a 10 MB budget, GitHub's attachment limit on
free plans. Build the MP4 from a WebM or from PNG frames captured at the
default 2x. PNG frames skip the screencast's JPEG and VP8 steps, so the MP4 is
smaller at the same CRF. Text looks the same up close.

To convert each WebM, use these settings, which keep text sharp:

```sh
for t in dark light; do
  ffmpeg -i showcase-captures/showcase-$t.webm -c:v libx264 -preset slow \
    -tune animation -crf 12 -pix_fmt yuv420p -movflags +faststart -an \
    showcase-captures/showcase-$t.mp4
done
```

To encode PNG frames, use the same settings with the frame list. The `fps=60`
filter turns the list's variable frame times into a constant 60 fps:

```sh
npm run showcase:capture -- --frames
for t in dark light; do
  ffmpeg -safe 0 -f concat \
    -i showcase-captures/showcase-$t-frames/frames.ffconcat \
    -vf "fps=60,format=yuv420p" -c:v libx264 -preset slow -tune animation \
    -crf 12 -movflags +faststart -an showcase-captures/showcase-$t.mp4
done
```

To add background music, mix a track into an MP4 without re-encoding its video.
Make the MP4 with the lowest CRF that fits the budget with 128 kbps audio. That
is usually `-crf 11` from PNG frames and `-crf 13` to `-crf 15` from a WebM,
and keeps text sharper than scaling the video down. The mix takes the track
from its start, cuts it to the video's length, sets it to 35% volume and fades
it out over the last second:

```sh
for t in dark light; do
  v=showcase-captures/showcase-$t.mp4
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $v)
  ffmpeg -i $v -i music.mp3 -filter_complex \
    "[1:a]atrim=0:$d,asetpts=PTS-STARTPTS,volume=0.35,afade=t=out:st=$(echo "$d - 1" | bc):d=1[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -movflags +faststart \
    -shortest showcase-captures/showcase-$t-music.mp4
done
```

### GIF

Capture PNG frames at the GIF's width, 1440 px with `--scale 0.9`. Scaling
frames down to the GIF's width softens text, and the resampled colors make the
GIF larger. Use a separate `--out` folder to keep 2x frames for the MP4. Build
the GIF with ffmpeg and [gifsicle](https://www.lcdf.org/gifsicle/)
(`brew install gifsicle`):

```sh
npm run showcase:capture -- --frames --scale 0.9
for t in dark light; do
  ffmpeg -safe 0 -f concat \
    -i showcase-captures/showcase-$t-frames/frames.ffconcat \
    -filter_complex "fps=100/3,split[a][b];\
[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
    /tmp/showcase-$t.gif
  gifsicle -O3 /tmp/showcase-$t.gif -o showcase-captures/showcase-$t.gif
done
```

The palette comes from the frames themselves, and `dither=none` keeps flat UI
and text crisp. `diff_mode=rectangle` redraws only the changed area of each
frame. Both themes use the same settings, and neither needs lossy compression
to fit the budget.

GIF frame delays use whole hundredths of a second, so 50, 33⅓, 25 and 20 fps
keep even timing. The GIF uses 33⅓ fps because 50 fps makes it much larger,
which would cut the width that fits the budget to about 1136 px. The GIF
favors readable text, and the linked MP4 shows smooth 60 fps motion. Some
renderers also slow 20 ms frames to 100 ms.

### README media

The README shows both GIFs and links to the dark MP4 with music. They are
GitHub attachments, so no media is committed. To replace one, drag the new file
into an issue, pull request or discussion comment in a browser, copy the
`user-attachments` URL it inserts without submitting the comment, and update
the URL in `README.md`. Keep the image's `width` at the GIF's width. The GitHub mobile app rejects video uploads.

### Story and playback

Playback opens with a 400 ms blank hold, then a 400 ms fade in with the first
prompt in the composer. One second after the blank hold, the composer clears
and the message enters the thread. The final hold ends with a 400 ms fade out
and a 400 ms blank hold. The opening delay comes out of the final hold, so the
loop keeps its length. Reduced motion skips the fades and message animations.

The story lives in `dev/panel/showcase/story.ts`. Each step lists the items
Codex adds and builds Claude's events with the fixture `Timeline`. A step's
`reply` holds the message that ends Claude's turn, which playback streams.
Playback timing lives in `dev/panel/showcase/playback.ts`. The Codex look lives
in `dev/panel/showcase/codex/`. Update it there when Codex changes.

The showcase loads `dev/panel/host/panel.html?now=<ms>`, which freezes the
panel's clock, so elapsed times are the same in every capture. During playback
`&tick` lets the clock run, and the showcase moves it forward as events arrive.

## Connect Codex from a checkout

Installed users get the plugin from the marketplace
([README](../README.md#install)). To run a checkout instead, build it, pick one
transport and add its example to `~/.codex/config.toml`. Both transports expose
the same task tools and MCP App.

- Remove the plugin first, or Codex runs both servers.
- Replace the existing server entry when switching transports. Do not combine
  stdio and HTTP settings.
- To return to the plugin, delete `[mcp_servers.subagent_extension_for_codex]` and
  its `env` or `http_headers` tables, and stop the checkout's service. The
  plugin never stops a service it didn't start.

See the
[Codex MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)
for supported options.

### Stdio

Run `npm run build`, then point Codex at the built launcher with an absolute
checkout path:

```toml
[mcp_servers.subagent_extension_for_codex]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]
```

The launcher reads the admin token and connects to the local service, starting
it when needed. If you override `SUBAGENT_EXTENSION_FOR_CODEX_DATA`, give the
service and launcher the same absolute path through
`[mcp_servers.subagent_extension_for_codex.env]`. See
[Task continuation](task-continuation.md) for recovery and state, and
[Admin token](configuration.md#admin-token) for token overrides.

### Streamable HTTP

Codex does not start the service over HTTP, so keep it running:

```sh
npm run build && npm start
```

Use `npm run build && npm run dev` for development instead, and follow
[What reloads when](#what-reloads-when) after edits.

Configure the authenticated `/mcp` endpoint:

```toml
[mcp_servers.subagent_extension_for_codex]
url = "http://127.0.0.1:17317/mcp"

[mcp_servers.subagent_extension_for_codex.http_headers]
Authorization = "Bearer <admin-token>"
```

Replace `<admin-token>` with the contents of `<data-directory>/admin-token`, or
with `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN` if the service uses that override. The
default data directory is `~/.local/share/subagent-extension-for-codex`. On macOS,
copy the token without printing it:

```sh
pbcopy < ~/.local/share/subagent-extension-for-codex/admin-token
```

Update the URL if you changed the service port. Keep the token and configuration
private, and never paste them into chats or commit them. Unlike the stdio proxy,
an HTTP client sends the token without checking that the
[service holds it](configuration.md#admin-token). On a computer shared with
other users, prefer the stdio proxy.

### Verify either connection

Reload the MCP connection in Codex and open **Delegated Work** from a chat. The
panel shows the same tasks as the dev host in live mode. `codex mcp list` shows
the configured server. Reconnect after changing tool metadata. To check UI
changes in Codex, see
[UI verification](ui-verification.md#measurement-and-checks-in-codex).

## Demo

```sh
npm run demo
```

The demo builds the project, registers a disposable repository at
`.subagent-extension-for-codex/demo-repository` and starts the service with only the
fixture worker, so it makes no model calls. Data lives in
`.subagent-extension-for-codex/demo`. Stop any other service on port 17317 first,
then sign in at `http://127.0.0.1:17317` with
`local-demo-only-not-a-real-token`.

To pair fake-worker tasks with UI hot reload:

1. Run `npm run demo` in one terminal.
2. Start Vite in another terminal with the demo connection:

   ```sh
   SUBAGENT_EXTENSION_FOR_CODEX_DATA="$PWD/.subagent-extension-for-codex/demo" \
   SUBAGENT_EXTENSION_FOR_CODEX_TOKEN=local-demo-only-not-a-real-token \
   SUBAGENT_EXTENSION_FOR_CODEX_URL=http://127.0.0.1:17317 npm run dev:ui
   ```

3. Open `http://127.0.0.1:5317`, choose **Data: live** and **Launch: global**,
   then **Relaunch**.
4. Select the demo repository in New task.

The panel sends real requests, so you can create tasks, send follow-ups, answer
questions and interrupt turns. The explicit variables keep Vite from using a
service configured in `.env`.

[Fixture scenarios](fixture-scenarios.md) lists the prompt triggers, expected
outcomes, queue controls and failure cases.

### Drive the demo from scripts

A browser script signs in the way the browser flows do, by posting the demo
token to `/api/login` with the service's `Origin`:

```js
await page.request.post("http://127.0.0.1:17317/api/login", {
  data: { token: "local-demo-only-not-a-real-token" },
  headers: { Origin: "http://127.0.0.1:17317" },
});
```

To call a tool with agent authority, post its arguments with the token as a
bearer credential and the `X-Subagent-Extension-For-Codex` header. Console
sessions and `/api/user-tools/` calls carry
[user authority](mcp-reference.md#app-and-user-authority).

```sh
curl -s http://127.0.0.1:17317/api/tools/update_settings \
  -H "Authorization: Bearer local-demo-only-not-a-real-token" \
  -H "X-Subagent-Extension-For-Codex: 1" -H "Content-Type: application/json" \
  -d '{"set":{"approvals":{"execution_mode":"deny"}}}'
```

## What reloads when

| Change                               | To see it                                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/panel/` in the dev host         | Nothing. Fast Refresh applies it                                        |
| `src/panel/` in Codex or the console | `npm run build`, then reopen the panel or reload the page               |
| `src/service/`                       | `npm run dev` restarts automatically. Restart `npm start` after a build |
| `src/shared/`                        | Refresh the panel as above. `npm run dev` restarts automatically        |
| Tool metadata or panel resource URI  | Restart the service, then reload the MCP connection in Codex            |
| `.env` or `vite.config.ts`           | Restart the affected processes                                          |

The service reads panel HTML from `dist/` on each resource request, so a rebuilt
UI needs no restart. If the file disappears, as when a plugin update removes the
running installation before handover, the service serves the last copy it read.

## Build

`npm run build` regenerates validation schemas, cleans `dist/`, type checks the
service, and builds the service entrypoints and `dist/app.html`. Each build
rejects imports from the other runtime, development tooling and tests.

- The service bundle includes its runtime packages, so an extracted package runs
  without `node_modules`. It ships no Claude Code binary and launches the
  installed [Claude Code CLI](claude-cli.md).
- Bundling drops package license files, so each build collects them into
  `dist/THIRD_PARTY_LICENSES.txt` for the service and
  `dist/app.html.THIRD_PARTY_LICENSES.txt` for the panel.
- Source maps omit embedded sources and map stack traces to the original files.
- Bundles live in `dist/bundle/`. The public entries `dist/main.js`,
  `dist/stdio.js` and `dist/projects-cli.js` are small ES2017 guards. Each
  checks Node against `engines.node`, prints what to install on an old runtime,
  then imports its bundle.

`npm run package:plugin` builds and packs the plugin. The package holds only
what the installed plugin runs or shows: `dist/`, `migrations/`, `assets/`,
`skills/`, `plugin.json`, `mcp.json`, the README and `LICENSE`. Guides stay on
GitHub, so the README's links to `docs/` don't resolve inside an extracted
package.

`npm run release:assemble`, run after a build, writes `release/`, the package
the release publishes to npm. It holds the packed files, a manifest with no
scripts or dependencies, and an `.agents/plugins/marketplace.json` that lists
the plugin with source `./`. The directory is both a Codex marketplace and the
plugin. [Install a local build](#install-a-local-build) installs it.

Adding the checkout itself (`codex plugin marketplace add ./`) adds `main`'s
marketplace, which installs the version it lists from npm, so test local builds
with `./release`.

The assembled marketplace takes its name and display name from `main`'s. The
name `shemarlindie` is part of the plugin ID and its `PLUGIN_DATA` path, so it
must not change.

Two package suites in `npm test` cover the result:

- `tests/integration/package/packed-artifact.test.ts` checks startup,
  transports, CLI readiness and restarts from an extracted package outside the
  checkout. It fails if the package's top-level file list changes.
- `tests/integration/package/marketplace-install.test.ts` assembles a release
  from `dist/`, packs it with npm and installs the extracted package with the
  Codex CLI into a temporary `CODEX_HOME`. It runs the MCP command Codex reports
  against an isolated data directory and port. It checks the reported version,
  tool listing and calls, and service startup. It needs the Codex CLI
  (`CODEX_BIN` or `codex` on `PATH`) and skips without it.

To run the marketplace test alone after a build:

```sh
npx vitest run tests/integration/package/marketplace-install.test.ts
```

Set `MARKETPLACE_SOURCE` to a published marketplace, such as
`owner/repo@v1.2.3`, to install that instead. Its version must match the
checkout's `package.json`. The release workflow does this after publishing.

### Install a local build

Run from the repo root (macOS or Linux):

```sh
npm run dev:plugin -- install
npm run dev:plugin -- update
npm run dev:plugin -- uninstall
```

Install and update build and assemble `./release` before replacing the plugin
and its `shemarlindie` marketplace. This also switches a published installation
to the local build. Uninstall is safe to repeat and keeps task data.

A terminal prompt offers to stop the running plugin service, defaulting to No.
Noninteractive runs leave it alone. Add `--stop-service` to any command to stop
without asking. This uses the existing [service handoff](task-continuation.md#updates-and-service-handoff):
running turns get up to 10 minutes to finish before the rest are interrupted.
Development services are left alone. A failed requested stop returns exit 1
even if installation or removal succeeded.

Reopen the panel and restart Codex for the new proxy and skills. Same-version
backend changes take effect after the service exits and the next proxy call
starts it again. Close existing Codex connections after uninstalling.

The script honors `CODEX_BIN`, `CODEX_HOME` and the shell's
`SUBAGENT_EXTENSION_FOR_CODEX_DATA`. It ignores the checkout's `.env`.

## Releasing

Users add `main`'s marketplace, `.agents/plugins/marketplace.json`, which
installs the plugin from npm at the exact version it lists. Codex refreshes it
on startup, so a version reaches users when `main` lists it. Each release has
its own branch:

1. On an up-to-date `main`, run `npm run release:prepare` and confirm the
   version it picks. Pass a version to choose it yourself, which a prerelease
   needs: `npm run release:prepare -- 1.2.0-beta.1`.
2. Review the drafted notes, which become the GitHub release notes. Rewrite them
   for users on the branch where needed: what changed, and anything they must do
   by hand. Then mark the pull request ready for review.
3. Run the **Release** workflow on the branch in GitHub Actions.
4. Once the workflow passes, re-run the pull request's **Listed version
   published** check, then merge with a merge commit. A squash or rebase merge
   would leave the tagged commit outside `main`'s history.

The script picks the next version from the conventional commits since the last
release: major for a breaking change, minor for a `feat` and patch otherwise.
Before 1.0, a breaking change bumps the minor version. It creates
`chore/release-v<version>` and sets the version in `package.json`,
`package-lock.json`, `plugin.json` and the marketplace. Unless `CHANGELOG.md`
already has a `## <version>` section, it drafts one with Features and Fixes
sections from the `feat` and `fix` commits. It commits, pushes and opens a draft
pull request to `main` that links to the notes. It needs the `gh` CLI, signed
in.

When `main` already lists an unreleased version, as with the first release,
run the **Release** workflow on `main`, with no branch or pull request.

The merge must follow the publish. If `main` lists an unpublished version,
Codex's refresh fails and keeps the installed version, and it doesn't retry once
the version is published, so users stay behind until `main`'s marketplace
changes again. The **Listed version published** check guards this. When a pull
request raises the listed version, the check fails until `v<version>` points at
the pull request's head commit. When it lowers the version, as a rollback does,
the tag only has to exist. The check blocks the merge once `main`'s ruleset
requires it.

A version with a prerelease suffix, such as `1.2.0-beta.1`, makes a prerelease.
It follows the same steps, publishes under the npm `next` tag, and its pull
request is closed without merging. Testers add the marketplace at its tag, and a
later release replaces its running service through
[updates and service handoff](task-continuation.md#updates-and-service-handoff).

To roll back, open a pull request that sets only the marketplace `version` to an
earlier release. That version is already on npm, so it can merge at once.

If the workflow fails before its npm publish step, fix the problem on the branch
and run it again. After that step, the version is spent, because npm versions
can't be republished. If only the GitHub release and its tag are missing, create
the release by hand on the branch's head, which also creates the tag. Otherwise,
close the pull request without merging and release the next version.
A push to the branch after publishing moves its head past the tag, so the check
fails until you drop the push or release a new version.

The workflow (`.github/workflows/release.yml`):

1. Runs the CI checks and installs the packed release with Codex. It fails if
   the marketplace and `package.json` versions differ or the tag exists.
2. Publishes `release/` to npm with provenance, under `next` for a prerelease.
3. Tags the published commit, the branch's head, as `v<version>` and creates its
   GitHub release with an attested zip, marked as a prerelease when the version
   has a suffix. npm's provenance, the tag and the merge then name one commit.
4. Installs `<owner>/<repo>@v<version>` with Codex on Linux, macOS and Windows,
   once npm serves the version.

The workflows pin the Codex CLI to the version the README lists as tested, so
change them together.

### npm publishing

The publish job runs on `ubuntu-latest`, since npm trusted publishing doesn't
support self-hosted runners. It installs npm 11.21.0, because Node 24's bundled
npm can't set dist-tags through OIDC. The publish step always passes
`NPM_TOKEN`. While the secret exists, npm publishes with it. Once it's deleted,
npm uses trusted publishing, so switching needs no workflow change.

### Repository and npm setup

The workflow relies on settings made by hand before the first release:

1. Make the repository public. npm generates provenance only for public
   repositories, and `codex plugin marketplace add owner/repo` fetches without
   credentials. First uninstall the self-hosted runner and delete the
   `MACOS_RUNNER` variable, as [CI runner](#ci-runner) describes.
2. Create the npm account with 2FA.
3. Create a granular token with publish access, bypass 2FA and an expiry of a
   few days, and save it as the `NPM_TOKEN` repository secret. The first release
   publishes with it, because a trusted publisher can only be configured for a
   package that already exists on npm.
4. After the first version is published, and no more than 2 days before the
   next release, configure the trusted publisher on npmjs.com: owner
   `shemarlindie`, repository `subagent-extension-for-codex`, workflow
   `release.yml`, with direct `npm publish` allowed. New configurations allow
   only `npm stage publish` by default, and a new configuration expires unless
   it publishes within 2 days. Then delete the `NPM_TOKEN` secret and revoke the
   token. If the first prerelease fails to set the `next` tag, also allow
   `npm dist-tag`.
5. Select **Enable release immutability** under **Settings → General →
   Releases**. Each published release then locks its tag and assets.
6. Add a tag ruleset for `v*` with **Restrict updates** and **Restrict
   deletions** and an empty bypass list. It covers tags without a published
   release. Leave creations unrestricted, because GitHub Actions can't be a
   bypass actor and the workflow creates the tags.
7. Add a branch ruleset on `main` that requires the **Listed version published**
   check, so a release pull request can't merge before its publish.

## CI runner

`.github/workflows/ci.yml` runs the checks on Linux and macOS for pushes to
`main` and pull requests. Windows runs the build, package tests and focused
settings file tests, including its native Downloads lookup. Other parts of
the suite use POSIX shell fakes.

The macOS checks run on a self-hosted runner when the `MACOS_RUNNER` repository
variable names its label, and on `macos-latest` when the variable is unset.
Release runs reuse these checks, so they follow the same routing. The release
`publish` and `install` jobs always use GitHub-hosted runners.

Use the runner only while the repository is private. In a public repository,
anyone could open a fork pull request that runs code on the host Mac. Before
making the repository public, run `install.sh --uninstall` and delete the
`MACOS_RUNNER` variable, so the macOS checks return to `macos-latest`.

The scripts in `dev/ci-runner` host the runner on a Mac. Each job runs in a
fresh [Tart](https://tart.run) VM cloned from the `macos-tahoe-base` image,
which includes the Actions runner and Node 24. `run.sh` deletes the VM after
the job. The scripts use your `gh` login to register runners and set the variable.
`dev/ci-runner/config.sh` holds the repository, image, label and VM size.

Install Tart and sleepwatcher, then the launchd agents:

```sh
brew install sleepwatcher
# Install Tart from https://github.com/cirruslabs/tart/releases
dev/ci-runner/install.sh
```

The agents run copies of the scripts, so rerun `install.sh` after changing
them. `install.sh --uninstall` removes the agents. Logs are in
`~/Library/Logs/ci-runner`.

The runner agent sets the variable when it starts and deletes it when it stops.
A sleepwatcher agent deletes it when the Mac sleeps and sets it again on wake.
A job that is running when the Mac sleeps fails.

If the variable stays set while the runner is offline, for example after a
crash or power loss, macOS jobs wait in the queue. Delete it under **Settings →
Secrets and variables → Actions → Variables** or with
`gh variable delete MACOS_RUNNER`, then cancel and re-run the waiting jobs.
Changing the variable doesn't move jobs that are already queued.

When GitHub releases a new Actions runner, pull a newer image with
`tart pull ghcr.io/cirruslabs/macos-tahoe-base:latest`. An outdated runner
updates itself at the start of every job.

## Checks

```sh
npx playwright install chromium
npm test
```

Install Chromium once after setup, and again when a Playwright upgrade needs it.

- `npm run typecheck` checks schema freshness and TypeScript across production,
  development and test code.
- `npm test` checks schema freshness, then runs formatting, lint, unused code
  and all three TypeScript projects alongside the build and tests. The tests
  wait for fresh production bundles. Browser flows finish before Vitest starts,
  so their workers do not compete. Every check and test must pass. The runner
  waits for all children before reporting a failure.
- `npm run check` runs the checks and build without tests. It checks schemas
  without rewriting them and builds fresh bundles without repeating type checks.
  Standalone `npm run build` still regenerates schemas and type checks the service.
  For individual failures, use `npm run schemas:check`, `npm run format:check`,
  `npm run lint`, `npm run knip` or `npm run typecheck`.

For focused checks during iteration:

| Command                      | Runs                                  |
| ---------------------------- | ------------------------------------- |
| `npm run test:e2e`           | Browser flows, after a build          |
| `npm run test:unit`          | Vitest `unit` and `unit-dom` projects |
| `npm run test:integration`   | Vitest `integration` project          |
| `npx vitest run <test-file>` | One test file                         |
| `npm run test:watch`         | Vitest in watch mode                  |

The Vitest commands skip the `npm test` preflight. Regenerate schemas after
contract edits, and build first when a test reads `dist/`.

Vitest keeps file isolation. The `unit-dom` project uses VM threads. Keep
process, SQLite and native-boundary tests in the Node projects because objects
returned by native APIs can cross VM realms.

Format edited files with `npx eslint --fix <files>`, then
`npx prettier --write <files>`. ESLint also lints Markdown, but check cross-file
links and heading fragments yourself after moving documentation.

Lint enforces the [runtime boundaries](architecture.md#code-ownership), React
hook rules and type-aware checks. TypeScript checks for missing values in
indexed reads. Type inputs by the data they can contain, and handle missing
values when reading them.

Lint also limits file length and complexity. Lower or remove exceptions when
refactoring, and explain any increase a change needs. Remove stale complexity
suppressions with `npx eslint . --prune-suppressions`. If Knip reports a file
loaded by path as unused, declare its entry point in `knip.json`.

Unit tests, including the jsdom suites in `tests/ui/`, time out after 15
seconds. Integration and browser tests allow 60 seconds for process and worktree
setup. Put shared colocated test setup in a `<module>-test-harness.ts` file,
which lint, type checks and builds treat as test code.

Compare DOM nodes with Vitest's `expect`, never Node's assertion equality
methods. Formatting a failed Node assertion can hang on jsdom's document graph.
Use `toBe` for identity, `toEqual` for structure and `toBeNull` for absence.

[UI verification](ui-verification.md) covers manual browser checks, and
[Live Claude checks](claude-verification.md#live-claude-checks) cover opt-in
tests that make model calls.

### Choosing test coverage

Before adding a test, name the behavior it protects and inspect existing
coverage. Give each behavior one primary test layer, starting from the broadest
that can reliably exercise it. Extend the test or suite that already owns it
when possible. These rules apply to tests added in the same change as well as
existing ones.

| Layer             | Location                                                                       | Covers                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Browser flows     | `tests/e2e/*.spec.ts`                                                          | User flows through the built console against real HTTP, SSE, SQLite and temporary Git repositories, with the fixture worker |
| Integration tests | `*.integration.test.ts` beside the owning code, or `tests/integration/`        | Service, transport, process and Git boundaries that need direct control or the console cannot reach                         |
| Unit tests        | `*.test.ts` or `*.test.tsx` beside the module, and jsdom suites in `tests/ui/` | Complicated logic and cases broader tests cannot reliably exercise                                                          |

Feature integration tests that combine task control with real SQLite, Git or
worker execution sit beside their owning code. Cross-runtime, HTTP, MCP,
package and process suites go in `tests/integration/`. Both run in Vitest's
`integration` project, which `test:unit` excludes. Classify a test by its
fixtures and assertions. Real socket and child-process tests belong in
integration coverage even with fake services or executables. A temporary
directory alone does not make a test an integration test.

Process tests should launch built `dist/` service entrypoints unless the source
loader is itself under test. Keep real process, socket and Git boundaries when
optimizing these tests.

Add unit tests only for parser boundaries, permission rules, async races, stale
responses, Unicode handling, state reconciliation and similar rules. Use jsdom
tests for deterministic failures, concurrent edits, keyboard behavior and host
bridge interactions that console browser tests cannot reproduce.

Remove happy-path unit and mocked UI tests once a browser or integration test
owns the same behavior, including tests written to check work in progress. Trim
cases and assertions individually, preserving unique rules and edge cases. Name
retained tests for the behavior they protect.

Test behavior and documented contracts. Skip assertions that only copy constant
tables, property projections, CSS declarations, SVG artwork or placeholder
markup. Derive expected results independently of the production helper being
tested. Keep parameterized cases, including viewport and theme loops, only when
they protect distinct rules or boundaries. Leave framework and standard-library
behavior to their own tests. Use the smallest fixtures that cross the relevant boundary, such as one row
past a rendering block, unless the test checks scale itself.

Keep fixture replay and preview simulation tests when production flows cannot
exercise their behavior.

Wait for readiness signals or explicit checkpoints instead of fixed sleeps.
Use worker checkpoints for queue and steer assertions, reserving elapsed-time
waits for timing behavior. Held checkpoints must remain interruptible during
cleanup. Paste incidental fixture text, and keep actual typing for keyboard
behavior. Mount the owning page for local form checks, and keep the full shell
for navigation, focus restoration and scope changes.

### Browser flows

`npm run test:e2e` builds, then runs workers on half the CPU cores. Each test
starts a disposable service on an OS-assigned loopback port, with its own
SQLite database, settings, fixture worker and Git repository. Teardown closes
the service and removes its files even when the test fails. In a sandbox, allow
localhost TCP listeners and browser processes.

Wait for mutations to finish before reloading. A modal hiding background
content from role queries does not prove that the mutation succeeded.

Rerun against an existing build with `npx playwright test`. Failures keep
traces and screenshots in `test-results/`, which CI uploads. A failed streamed
reply flow in `chat-reading.spec.ts` also saves `chat-scroll.json`, which logs
Chat's scroll position, scroll button and rows with each scroll event and reader
input. Traces do not record scroll positions after each change. Inspect a trace
with `npx playwright show-trace <trace.zip>`. Give concurrent Playwright
commands distinct `--output` directories so one run cannot delete another's
results.

[Browser flows](../tests/e2e/README.md) describes how the flows set up state,
how to measure their performance and what they leave to other checks.

## Send latency measurements

[Measure performance](logging.md#measure-performance) covers task timing
records, transport measurements and resource samples. Use them to compare
message latency and scheduler work before changing performance behavior.

## Troubleshooting

| Symptom                                       | Cause and fix                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Dev host live mode logs 502                   | The service is not running, or not on the port Vite resolved at startup                       |
| Dev host live mode logs 401                   | Vite and the service use different data directories, so the token does not match              |
| Codex shows different tasks than the dev host | Codex's `SUBAGENT_EXTENSION_FOR_CODEX_DATA` differs from `.env`                               |
| Service exits on start                        | Another service owns the data directory, or the port is taken, for example by the demo        |
| `npm test` reports a check failure            | Run the schema, formatting, lint, unused code, type or build check individually to isolate it |
| Missing or stale generated schema             | Run `npm run schemas:generate`, then `npm run schemas:check`                                  |
| No schema contracts found under `src`         | Run the command from the project root, and check that source files use `*-contract.ts`        |
| Permissive validator rejected                 | Import the type from a discovered `*-contract.ts` file, or write the schema by hand           |
