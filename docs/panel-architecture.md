# Panel architecture

Use this guide when changing the React panel, its state or transports. It owns
frontend implementation patterns; [the panel guide](panel-guide.md) owns
user-visible behavior, and [UI verification](ui-verification.md) owns browser checks.

Delegated Work is the only UI. It runs embedded in a host and in a regular browser tab against the HTTP service. One entrypoint (`src/panel/app/app.ts`) builds one page, `dist/app.html`. At runtime `src/panel/app/environment.ts` picks the transport from where the page renders (an iframe uses the host bridge, a top-level page with an injected API origin uses HTTP, anything else shows "Open through MCP"), and `src/panel/app/bootstrap.tsx` creates the controller and mounts the shell. Fixtures exist only in development, through the panel dev host; `scripts/build-panel.mjs` fails the build if fixtures or the dev host reach the production bundle. Service APIs, MCP resources, and standalone routes remain the integration boundaries.

## Module boundaries

| Directory or file                                                   | Responsibility                                                                                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/panel/app/`                                                    | Entrypoints, environment selection, page shell, and HTML template.                                                                                                            |
| `src/panel/features/tasks/`                                         | Task list, inspector, Chat, activity, evidence tabs, and task controls.                                                                                                       |
| `src/panel/features/file-preview/`                                  | File previews: format detection and the code, Markdown, table, diff and image viewers, used by the Changes tab; Chat and Activity share the Markdown view.                    |
| `src/panel/features/projects/`, `delegation/`, `settings/`, `auth/` | Project management, registration and scope, task delegation, settings, and login.                                                                                             |
| `src/panel/app/state/`                                              | Application controller coordination, persisted UI state, composed snapshots, selector exports, and React context. Feature-owned types and selectors stay with their features. |
| `src/panel/shared/components/`, `dialogs/`, `forms/`, `utils/`      | Reusable UI primitives and cross-feature helpers, including persisted dialog-form state.                                                                                      |
| `src/panel/transports/`                                             | Console HTTP/SSE and MCP host bridge transports and their contracts.                                                                                                          |
| `dev/panel/scenarios/`, `dev/panel/host/`                           | Development fixtures and the mock MCP Apps host; excluded from production bundles.                                                                                            |
| `src/panel/styles/app.css`                                          | Global stylesheet index; feature styles live beside their feature modules.                                                                                                    |
| Co-located `*.test.ts`; `tests/integration/`                        | Focused tests sit by the modules; cross-feature and environment tests stay in the integration suite.                                                                          |

The Changes feature (`src/panel/features/changes/`) owns change reads, file
selection, worktree actions and the Changes tab. File viewers remain in
`file-preview/`, so their rendering can be reused outside task changes.

The panel imports browser-safe contracts and domain functions from
`src/shared/<feature>/`, never service modules. The shared runtime boundary is
explained in [Architecture](architecture.md#code-ownership).

Chat groups editable message composition in `composer/`, queued-turn controls
in `queue/`, and message rendering and reading position in `timeline/`.
File preview groups substantial viewers in `code/`, `markdown/`, `diff/` and
`table/`, with shared format detection and viewer composition at the feature
root. Keep helpers and focused tests with their responsibility.

Shared components group substantial families such as buttons, selects, notices,
motion and editable text with their CSS and tests. Generic time and scrolling
helpers live in `shared/utils/`. Global tokens, resets and primitive styles
remain in `styles/`; application layouts live in `app/styles/`. `app.css`
imports all production CSS in cascade order.

Editable text keeps its hidden text measurement in normal flow while read-only,
so titles have their natural height on the first render. Only editing uses the
measured control height. This lets parent arrival animations measure a settled
header before the editor's layout state updates.

Application state groups dialog descriptors, saved drafts and restoration in
`app/state/persistence/`, and in-memory session state and hooks in
`app/state/session/`. Transport size tracing stays with `transports/`.

`Controller` is the one facade components call. It keeps scope versions,
selection and refresh sequencing, and delegates self-contained work to
collaborators that receive a small context of callbacks: `DialogLoader` opens
the settings and Advanced task dialogs while their reads load,
`PersistedDialogs` keeps the dialog stack a reload reopens, and the
feature-owned `ChangeLoader` and `DraftFollower` read changes and drafts for the
selected task. `RevisionTrigger` turns the service revisions a transport reports
into throttled refreshes, deferred while the panel is hidden or busy. On
transports that don't stream changes (`streamsChanges`), `UpdateFollower` holds
the `wait_user_agent_updates` long poll that reports them, carrying
`DraftFollower`'s draft target. See [Transport](panel-guide.md#transport) for
the refresh behavior. Components call `controller.taskActions` for task actions taken
outside a dialog, such as sending messages, editing the queue, raising budgets
and answering worker requests.

The new-task composer lives in `features/delegation/new-task/`. Components call
`controller.newTasks`, a feature-owned `NewTaskLoader`, to open the composer,
retry its reads and start the task. While it is open, `Snapshot.newTask` holds
its read state; selecting a task clears it. The composer and the Advanced task
dialog share their settings, project and worker reads
(`app/state/delegate-reads.ts`), the `start_agent_task` arguments
(`start-task.ts`), model and reasoning defaults (`model-defaults.ts`) and the
async-default fill (`use-async-defaults.ts`). The composer keeps its draft in
session memory, not in dialog persistence, so it doesn't survive a reload.
The composer reuses Chat's composer markup and styles. On start it records its
box height as the task session's `composerArrival`, and the inspector's
`useArrivalMotion` reveals the header and tabs and settles the Chat composer
from that height. It also sets `composerFocus`, and Chat's composer takes
focus once the task's events load and it is enabled.

## State ownership and component patterns

The controller owns UI state and async coordination. Components subscribe to immutable snapshots and call controller actions. Forms own their editable drafts through React Hook Form, so refreshes do not replace field nodes or reset unsent input. Pure rendering components can receive props without needing controller access. Feature and component tests live beside those modules; the Vitest and TypeScript test configurations discover them separately from production builds.

Components read session memory with `useSessionState(scope, id, select?)` and
partial updates. Select a stable field/reference to avoid unrelated rerenders.
Scroll hooks mutate stable reading cells without notifying on every scroll;
answered questions clear their entry. See [State and persistence](#state-and-persistence)
for lifetime and storage boundaries.

Use Base UI (`@base-ui/react`) primitives for dialogs, tabs (with an animated indicator), the task filter radio group, single and multiple selection, project suggestions, and settings switches, including focus management and keyboard navigation. `SelectField` and `MultiSelectField` share dropdown structure and styling; `FormSelect` connects selection to React Hook Form. `ChipSelect` reuses that dropdown behind a compact pill trigger for options beside an input, such as the new-task composer's chips. Project and dependency selectors opt into `LookupField`, which uses Base UI Combobox with a search input in the popup; search text stays separate from selected values. The project autocomplete accepts both registered projects and explicit absolute paths. Keep simple buttons, text inputs, and textareas as native controls. Base UI provides unstyled components; keep their styling in this project's stylesheets and application decisions in the controller/forms. React, React DOM, React Hook Form, and the official MCP Apps bridge supply existing infrastructure rather than custom equivalents.

Build tab strips with the shared `TabList` in
`src/panel/shared/components/tabs/`; it provides the standard focus behavior and
animated indicator. When a selection can change outside the tab list, use
`useActiveTabInView` with stable tab IDs so only the strip scrolls to reveal the
selected tab. Horizontal strips in narrow layouts can extend to the container
edges while padding their labels back into alignment with the panel content.

## Motion

Motion is short and quiet. Its purpose is to show what changed and to ease layout shifts. In `src/panel/shared/components/motion/motion.css`, `--motion-fast`, `--motion-base`, `--motion-slow`, and `--motion-loading-crossfade` mirror the matching duration fields in `MOTION` from `src/panel/shared/components/motion/motion-utils.ts`; `--ease-out` mirrors its `easing` field. Keep these definitions in sync. Base UI dialogs, popups, and collapsible panels animate through their `data-starting-style` and `data-ending-style` attributes. A collapsible panel uses the `collapse-panel` class and puts its padding and border on an inner element, so the height animation stays smooth. For other content, use the primitives in `src/panel/shared/components/motion/`, one per file, and the reduced-motion helpers in its `motion-utils.ts`:

- `Presence` folds content in or out, or pops it, and keeps the last content mounted while it leaves. Content present on its first render appears in place unless you pass `appear`.
- `useListPresence` pairs a keyed list with `Presence` (use `as="li"` inside lists): removed items stay in place while they exit, and items added after the first render are marked to appear.
- `useAnimatedHeight` eases a size change in place.
- `useListMotion` slides keyed rows to their new positions, including rows that move between parents.
- `useAutoList` (in `auto-list.ts`) wraps AutoAnimate (`@formkit/auto-animate`) with the shared tokens. Attach its ref to a list, as in the chat message queue, and its direct children fade in, fade out and slide when reordered. The list eases its own size, so content around it follows. Children need boxes of their own, so don't wrap them in `Presence`.
- `MotionContent` keys changing text or counts and applies a fade or rise without moving surrounding content.

Animations that run while the activity timeline measures positions change only opacity, so they never disturb its reading position. Reduced-motion preferences turn every animation off. The Web Animations helpers also skip animation where the API is missing, as in jsdom tests.

## Loading and pending UI

Show feedback in the first render that knows a read is pending. Keep stable
shells and known navigation visible, including tab labels and selection. Keep
labels and values that do not depend on the pending read. Use a feature-shaped
skeleton when the expected structure is known. For content with widely varying
layouts, such as file previews, use a centered spinner. Keep still-valid content
visible and show progress beside it. Skeleton layouts belong to their feature:
match the expected content's structure and size, and compose shared
`SkeletonShape` blocks instead of sharing one layout across unrelated views.

Use the text-height helpers by default for placeholders that stand in for text.
`measureText` is the shorthand for one placeholder; it wraps the shape in a
`SkeletonTextFrame`. Use `SkeletonTextFrame` directly when several compact
shapes stand in for a text block:

```tsx
<SkeletonShape className="line" measureText={description} />

<SkeletonTextFrame text={description}>
  <div className="description-lines">
    <SkeletonShape className="line-wide" />
    <SkeletonShape className="line-short" />
  </div>
</SkeletonTextFrame>
```

The hidden measurement inherits typography and available width from its parent,
so place it under the same text styles as the loaded content. Pass the loaded
text when available; while it is unknown, use representative text with the
expected line count. This reserves the text's line height and wrapping without
making the shimmer as tall as the text. Use plain shapes for icons, controls,
badges and other elements whose size comes from fixed structure rather than
text.
`LOADING_SKELETON_CONFIG` in `loading-skeleton-config.ts` controls skeleton
behavior independently of CSS motion durations. Its `delay` is the threshold
before a skeleton appears; reads that finish before it elapses skip the
skeleton, while control-level spinners stay immediate. Configure `delay` for
immediate display when skeletons should appear as soon as loading starts.
`minimumVisible` is how long a skeleton in `LoadingSwap` stays fully visible
before its handoff begins.

Use `LoadingSwap` when a placeholder will be replaced by loaded content. It
layers both in the same grid area, marks the region busy by default, and delays
the handoff until the minimum visible time has elapsed. It then keeps the
skeleton mounted through the shared `MOTION.loadingCrossfade` fade, mirrored by
the `--motion-loading-crossfade` CSS token. Keep the same `LoadingSwap` mounted
in both the loading and ready renders so its minimum time and fade can finish.
Keep the task inspector and tab list mounted while a selected task is fetched;
swap the header and active tab content in place. Let each tab's loading swap
span both the task lookup and its own read so the same placeholder stays in the
same slot until real content is ready.
Without a restored selection, the inspector cannot know which layout follows
the first task-list read, so it shows a centered spinner instead of its empty
state. `TaskInspectorLoading` overlays the inspector rather than using
`LoadingSwap`, because the task view and the empty state are separate layouts;
it stays mounted through the same crossfade while the arriving content fades in.
For inline values such as counts, use `as="span"` with `loading-swap-inline`.
Task Details uses the same metadata and facts grid for its full skeleton while
the task record is unavailable; once the task arrives, separately pending
values such as the Changes count use an inline swap. The inactive layer is
hidden and inert.
`LoadingSkeleton` provides the accessible status; use `announce={false}` when a
parent already announces the same pending read. Match the skeleton's height and
scrollbar space to the real view, and restore saved reading position before the
handoff when the view owns one. Use `blockScroll` for tall skeletons whose
viewport should not scroll, without shortening them. Reduced-motion preferences
make shimmer and the fade effectively instant; the minimum visible time remains
in effect.

For forms and dialogs, render the known structure immediately and finish async
reads in place. Keep labels, help text, and control geometry stable. Use
`AsyncControl` to overlay a spinner on a pending input or textarea,
`FormSwitch` for a pending toggle, and `SelectField` with `loading` while its
selected value or options are unresolved; the select replaces its caret with a
spinner and announces the read. If a value is already known but another pending
dependency blocks editing, keep the value visible and disable the control
without a spinner. Disable actions that depend on pending data, leave unrelated
controls responsive, and replace failed reads with local error and retry UI.

See [Slow async reads](ui-verification.md#scope-and-host-controls) to inspect
pending states in the fixture UI; [the panel guide](panel-guide.md) describes
their user-visible behavior.

## Shared controls

Banner messages use `Notice` and `NoticeText` from `src/panel/shared/components/notice/notice.tsx`. Pass `tone` (`warning`, the default, `error`, `info` or the accent-free `plain`) rather than adding a new banner class; the tone only changes the accent color in `.notice[data-tone]`. `NoticeText` clamps long text behind **Show more**.

Icons live in one catalog, `ICONS` in `src/panel/shared/components/icons/icons.tsx`. Render them with `<Icon name="bug" />` rather than inline `<svg>` markup. Every glyph uses the shared 24-unit viewBox and defaults to 16 px; pass `size` to override its rendered size. To add a glyph, include its tight geometry bounds, path data, optional shapes, and stroke width. Icons are decorative unless you pass `label`, and `className` and other SVG props pass through.

Use `<Chevron />` for compact dropdown and disclosure carets. It keeps a square layout footprint while preserving the caret's smaller drawn size.

Buttons use `<Button>` from `src/panel/shared/components/button/button.tsx`, with a `variant`:

- `default`: the bordered secondary button beside a primary one, such as Cancel or Back.
- `primary`: the filled button that submits or confirms.
- `ghost`: borderless until hovered, for toolbar and navigation buttons.
- `text`: muted text with no box, for low-emphasis inline actions. Only this variant takes `underline`.

`type` defaults to `"button"`, so pass `type="submit"` for a form's submit button. Base UI parts that render their own button, such as `Dialog.Close` and `Menu.Trigger`, take `className={buttonClass("ghost")}`. Both themes style the variant classes (`primary`, `ghost`, `text-button`). Components with their own look, such as task rows and filter pills, keep a native `<button>` with their own class.

## Page navigation

Application page identity, availability and retention live in
`src/panel/app/navigation/pages.ts`. The controller applies its navigation guard
to user-requested page changes. Tasks and Settings are available in chat and
global scope; Projects requires a connected, resolved global scope. Busy work
and open modal dialogs block user navigation. A host scope change into a chat
returns from a global-only page to Tasks and invalidates stale dialogs.

`PageOutlet` composes the registered page components. Tasks stays mounted while
inactive to preserve drafts and reading positions; its container is hidden and
inert. Projects and Settings unmount on departure. The outlet remembers focused
controls in retained pages and restores them on return. `PageFrame` provides a
labeled full-width section, arrival heading focus, back control and actions;
`BackButton` supplies the shared back-control presentation. Task detail selection
and inspector tabs remain owned by the Tasks page rather than becoming separate
application pages. Add project and removal confirmation remain dialogs.

To add a page, declare its identity, label, scope requirement, retention policy and fallback focus target
in `pages.ts`, then add its component to the outlet's typed component map. Keep
feature content with its owning feature and use `PageFrame` for pages with a
heading and toolbar. Route navigation through the controller so scope, busy and
dialog guards apply consistently. Add focused coverage for its availability,
URL restoration, lifetime and focus behavior.

## Extending the UI

- Add a component when a section has a clear responsibility, reused presentation, or an independent interaction. Compose these sections in the inspector or shell; avoid moving networking or scope bookkeeping into JSX.
- Reuse the selection fields for new dropdowns and the existing project autocomplete for editable project suggestions. Keep primitive styling beside its component or dialog (listed in cascade order by `src/panel/styles/app.css`); define surface colors through CSS variables in `src/panel/styles/theme.css`, and put panel layout in `src/panel/app/styles/`.
- Add a form for a new user-reviewed operation. Share fields and footers, declare its typed dialog variant, export a `defineDialog` definition (title, render, optional title-row controls and initial focus) from the form, and register it in `src/panel/shared/dialogs/dialog-registry.ts`; `DialogHost` stays a generic shell. Submit through `controller.submit` to retain busy/error handling and the scope captured when the dialog opened. Send messages or execute tools only after the user submits.
- Add a selector for a pure calculation shared across views. Keep transport calls and mutation outside selectors.
- Add a transport when the connection mechanism changes. Implement `Transport` and deliver `TransportEvents`; select it in bootstrap. Rendering and forms should not branch on HTTP versus MCP tool envelopes.

Keep scope handling centralized. Task/detail generation checks discard delayed responses after selection changes, and disposal cancels refresh scheduling and connection resources. See [State and persistence](#state-and-persistence) for scope changes and dialog lifetime.

## State and persistence

The controller separates session memory from recoverable view state.
`bootstrap.tsx` installs reload persistence for the standalone console and the
development host. The production embedded panel has no persistence adapter, so
its controller-owned view choices and drafts last only while that controller
remains mounted. The task rail width is separate: `TaskLayout` reads and writes
`dw_task_list_width` directly in local storage wherever storage is available.

`controller.session` stores per-task tabs, composer drafts/visibility, reading
positions (including Changes' opened files), viewed changed files, and question
answers until the controller is replaced. This session memory does not persist
across reloads.

The console and development host persist the following state:

- Browser URL state stores the application page, project selection, selected
  task/list, tab, search and status filter. It does not store the conversation
  ID. The dev host mirrors view state into its outer URL; Codex has no URL-state
  bridge. Search and form drafts persist after a 250 ms debounce, flushed on
  page exit.
- Boolean `dw_dlg_<name>=1` flags record open dialogs. Ordered descriptors and
  compatible form drafts live in local storage, falling back to session storage
  if local storage is unavailable. The newest dialog restores
  first. Closing removes a descriptor, and successful dialog submissions do
  the same. Settings keeps its descriptor while the page is open so its draft
  can restore after reload; saving updates its baseline and leaves the page
  open. Server-owned data is reloaded; authentication tokens are never form
  drafts.
- The last selected Settings section is browser-local and can appear as soon
  as the Settings page opens.

Changing scope invalidates outstanding reads and closes stale dialogs. A
submitted mutation is never repeated automatically. Collapsing the embedded
panel hides dialogs while preserving their drafts for expansion.

## Feature integration points

- **Chat:** `src/shared/tasks/conversation/chat.ts` supplies `chatItems` to both the service
  and preview. `mergeChat` updates repeated items in place. HTTP transports use
  SSE drafts; host transports receive drafts through `UpdateFollower`'s waits.
  `TaskActions` (`controller.taskActions`) runs queue/send/interrupt actions and
  returns their failures for inline display.
- **Settings:** `src/shared/settings/settings-document.ts` supplies typed
  sections and rows. `src/panel/features/settings/settings-layout.ts` owns form logic.
  Save only changed fields; preserve disabled budget amounts. Inactive tab
  panels remain mounted for validation, and invalid fields select their section.
- **Activity:** grouping and presentation retain original events for debug
  inspection. `Timeline`, `TimelineItem` and `TimelineDot` use Base UI `useRender`
  and expose state attributes for styling. Expensive raw response rendering
  starts only when its inspector opens.
- **File preview:** `src/panel/features/file-preview/` owns format detection and
  Markdown, source, diff, table and image views. Render the whole file with
  deferred row blocks for large content. SVG images over 64 KiB show as source
  only. See the
  [file-preview guide](../src/panel/features/file-preview/README.md) for format
  behavior and rendering limits.

For user-visible behavior and host scope rules, see the
[panel guide](panel-guide.md). For fixture scenarios and browser checks, see
[UI verification](ui-verification.md).

## Build and verification

`scripts/build-panel.mjs` bundles the entrypoint with Vite's build API (one minified ES module, the automatic JSX runtime through `@vitejs/plugin-react`, and `process.env.NODE_ENV="production"`). It does not read `vite.config.ts`, which configures only the dev host. It embeds JavaScript and CSS into `dist/app.html`, preserving self-contained HTML delivery without runtime CDN requests. The build also parses the final embedded module with Vite's `parseAst` to catch template replacement corruption. Edit source files, then rebuild; generated HTML is not the source of truth. Run `npm run typecheck` and `npm test` as described in [Local development](development.md#checks).

Typechecking covers server TypeScript, the browser/TSX configuration in `tsconfig.panel.json`, and the tests and Vite configs through `tsconfig.test.json`. The test suite includes controller scope/race/lifecycle checks, HTTP and host transport contracts, and React Testing Library/user-event interactions in Vitest's jsdom environment. React interaction tests cover keyboard tabs, dialog focus restoration, draft preservation through refresh, budgets, worker input, the Chat composer's keys, queue controls and budget raise, explicit handoff submission, and literal text rendering. Automated DOM/protocol checks do not establish actual browser layout or native host placement; verify those separately for changes affecting them.
