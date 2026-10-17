# Panel architecture

Use this guide when changing the React panel, its state or transports.
[The panel guide](panel-guide.md) describes user-visible behavior, and
[UI verification](ui-verification.md) covers browser checks.

Delegated Work shares one React application between the embedded MCP App and
standalone console. Bootstrap selects the host bridge or HTTP transport. Rendering
and forms use the same controller interface. The production build embeds the
application in `dist/app.html` and excludes development fixtures.

## Module boundaries

| Area                    | Responsibility                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| `src/panel/app/`        | Application composition, navigation, state and async coordination. |
| `src/panel/features/`   | Domain UI, actions, selectors and feature styles.                  |
| `src/panel/shared/`     | Reusable primitives, dialogs, forms and cross-feature helpers.     |
| `src/panel/transports/` | HTTP/SSE and MCP bridge connections behind a common contract.      |
| `dev/panel/`            | Fixtures and the mock host, excluded from production.              |

The Changes feature (`src/panel/features/changes/`) owns change reads, file
selection, worktree actions and the Changes tab. File viewers remain in
`file-preview/`, so their rendering can be reused outside task changes.

Read tracking belongs to `features/tasks/unread/`. The service owns durable read
state. The panel updates the list optimistically and reconciles it on refresh.
Chat records only content it has loaded and displayed at the latest position.
Keep reading-position and unread-divider behavior coordinated so incoming events
do not move a reader through history or briefly mark an open task unread.

The panel imports browser-safe contracts and domain functions from
`src/shared/<feature>/`, never service modules. The shared runtime boundary is
explained in [Architecture](architecture.md#code-ownership).

Keep helpers and focused tests beside the feature or component they serve.
Feature styles live with their modules. Global tokens and resets remain in
`styles/`, and application layouts in `app/styles/`. `styles/app.css` imports
production CSS in cascade order.

Application state separates reload persistence (`app/state/persistence/`) from
session memory (`app/state/session/`). `Controller` owns scope, selection and async
coordination, delegating feature work to loaders and actions. Components use
`controller.taskActions` for task mutations and `controller.newTasks` for the
new-task composer. Transport revisions and draft following stay outside rendering.

The new-task composer and Advanced task dialog share settings reads and task-start
arguments. Preserve their intentional profile difference: the composer starts
with General, while Advanced task uses the saved profile. Other task defaults
and submission policy use the shared delegation logic. The composer draft lives
in session memory and does not survive reload.

## State ownership and component patterns

The controller coordinates UI state and async work. Components subscribe to
immutable snapshots and call controller actions, while pure rendering components
can receive props directly. Forms manage editable drafts through React Hook Form
so refreshes preserve field nodes and unsent input.

Components read session memory with `useSessionState(scope, id, select?)` and
partial updates. Subscribe to stable fields or references to avoid unrelated rerenders.
Scroll hooks mutate stable reading cells without notifying on every scroll.
Answered questions clear their entry. See [State and persistence](#state-and-persistence)
for lifetime and storage boundaries.

Use Base UI (`@base-ui/react`) for dialogs, tabs, selection, autocomplete and
switches, with project styling and React Hook Form for editable drafts. Keep
simple buttons, text inputs and textareas native. Reuse the shared selection
fields and `TabList` to preserve consistent keyboard and focus behavior. Keep
search text separate from selected values in lookup fields. When selection can
change outside a tab strip, reveal the selected tab without scrolling its parent.

## Motion

Motion shows what changed and eases layout shifts. Reuse the primitives in
`src/panel/shared/components/motion/` for presence, keyed lists, height changes
and changing text. Keep the JavaScript `MOTION` values and matching CSS tokens
in sync. Loading policy has its own configuration.

Use Base UI's transition attributes for its popups and collapsible panels.
Keep padding and borders inside a collapsing panel so they do not interfere
with its height animation. Children animated by `useAutoList` need their own
layout boxes and must not use `Presence` wrappers. Make controls inert while
they leave.

Animations must preserve reading position. In measured timelines, use
opacity animations to keep row geometry stable. Respect reduced-motion preferences.
Skip animation when the Web Animations API is unavailable, including in tests.

## Loading and pending UI

Show feedback as soon as a read is pending. Keep the surrounding layout,
navigation, labels and known values visible. Use a skeleton that matches the
expected content when its structure is known. For content with widely varying
layouts, such as file previews, use a centered spinner. Keep still-valid content
visible and show progress beside it. Skeleton layouts belong to their feature:
match the expected content's structure and size, using shared
`SkeletonShape` blocks to build a layout for each view.

Use `SkeletonShape`'s text measurement helpers under the same typography and
width as the loaded content so placeholders reserve realistic space. Plain
shapes suit icons and controls. `LOADING_SKELETON_CONFIG` controls the delay that
avoids flashes on fast reads and the minimum time a shown skeleton remains visible.

Use `LoadingSwap` for the handoff from a placeholder to content, keeping the same
instance mounted throughout loading and readiness. Its inactive layer is hidden
and inert. Keep task navigation mounted while task and tab reads finish in place.
Restore saved reading positions before revealing content. Avoid duplicate status
announcements when a parent already announces loading.

For forms and dialogs, render the known structure immediately and finish async
reads in place. Keep labels, help text, and control geometry stable. Use
`AsyncControl` to overlay a spinner on a pending input or textarea,
`FormSwitch` for a pending toggle, and `SelectField` with `loading` while its
selected value or options are unresolved. The select replaces its caret with a
spinner and announces that it is loading. If a value is already known but another pending
dependency blocks editing, keep the value visible and disable the control
without a spinner. Disable actions that depend on pending data, leave unrelated
controls responsive, and replace failed reads with local error and retry UI.

See [Slow async reads](ui-verification.md#scope-and-host-controls) to inspect
pending states in the fixture UI. [The panel guide](panel-guide.md) describes
their user-visible behavior.

## Shared controls

Reuse `Notice` for banner messages and `NoticeText` for expandable long text,
keeping shared presentation out of feature-specific banner classes.

Use the shared icon catalog through `Icon`, and `Chevron` for compact carets.
Icons are decorative unless given a label. Use the shared `Button` variants for
primary, secondary, toolbar and inline actions. Pass `type="submit"` explicitly
for form submission. Base UI button parts can reuse `buttonClass`. Domain
controls such as task rows may keep their own native buttons and styles.

## Page navigation

Application page identity, availability and retention live in
`src/panel/app/navigation/pages.ts`. The controller applies its navigation guard
to user-requested page changes. Tasks and Settings are available in chat and
global scope. Projects requires a connected, resolved global scope. Busy work
and open modal dialogs block user navigation. A host scope change into a chat
returns from a global-only page to Tasks and invalidates stale dialogs.

`PageOutlet` composes the registered page components. Tasks stays mounted while
inactive to preserve drafts and reading positions. Its container is hidden and
inert. Projects and Settings unmount on departure. The outlet remembers focused
controls in retained pages and restores them on return. `PageFrame` provides a
labeled full-width section, heading focus on entry, a back control and actions.
`BackButton` supplies the shared back-control presentation. The Tasks page owns task detail selection
and inspector tabs. Add project and removal confirmation remain dialogs.

To add a page, declare its identity, label, scope requirement, retention policy
and fallback focus target in `pages.ts`. Then add its component to the outlet's
typed component map. Keep
feature content with its owning feature and use `PageFrame` for pages with a
heading and toolbar. Route navigation through the controller so scope, busy and
dialog guards apply consistently. Add focused coverage for its availability,
URL restoration, lifetime and focus behavior.

## Extending the UI

- Add a component when a section has a clear responsibility, reused presentation, or an independent interaction. Compose these sections in the inspector or shell. Avoid moving networking or scope bookkeeping into JSX.
- Reuse the selection fields for new dropdowns and the existing project autocomplete for editable project suggestions. Keep primitive styling beside its component or dialog (listed in cascade order by `src/panel/styles/app.css`). Define surface colors through CSS variables in `src/panel/styles/theme.css`, and put panel layout in `src/panel/app/styles/`.
- Add a form for a new user-reviewed operation. Share fields and footers, declare its typed dialog variant, export a `defineDialog` definition (title, render, optional title-row controls and initial focus) from the form, and register it in `src/panel/shared/dialogs/dialog-registry.ts`. `DialogHost` stays a generic shell. Submit through `controller.submit` to retain busy/error handling and the scope captured when the dialog opened. Send messages or execute tools only after the user submits.
- Add a selector for a pure calculation shared across views. Keep transport calls and mutation outside selectors.
- Add a transport when the connection mechanism changes. Implement `Transport` and deliver `TransportEvents`. Select it in bootstrap. Rendering and forms should not branch on HTTP versus MCP tool envelopes.

Keep scope handling centralized. Task/detail generation checks discard delayed responses after selection changes, and disposal cancels refresh scheduling and connection resources. See [State and persistence](#state-and-persistence) for scope changes and dialog lifetime.

## State and persistence

The controller separates session memory from recoverable view state.
`bootstrap.tsx` installs reload persistence for the standalone console and the
development host. The production embedded panel has no persistence adapter, so
its controller-owned view choices and drafts last only while that controller
remains mounted. The task rail width is saved separately wherever browser storage is available.

`controller.session` stores per-task tabs, composer drafts/visibility, reading
positions (including Changes' opened files), viewed changed files, and question
answers until the controller is replaced. This session memory does not persist
across reloads.

The console and development host persist view choices in the browser URL and
open-dialog descriptors and form drafts in browser storage. The dev host mirrors
view choices into its outer URL. Conversation IDs and authentication tokens are
not saved as view state or form drafts. Server data is reloaded on restoration.
Closing or successfully submitting a dialog removes its saved descriptor.
Settings remains open after saving and updates its draft baseline. Its last
selected section is also browser-local.

Changing scope invalidates outstanding reads and closes stale dialogs. A
submitted mutation is never repeated automatically. Collapsing the embedded
panel hides dialogs while preserving their drafts for expansion.

## Feature integration points

- **Chat:** browser-safe conversation functions in `src/shared/tasks/conversation/`
  serve both the service and preview. Task actions own send, queue and interrupt
  operations. Transports supply transient drafts separately from stored messages.
- **Settings:** the service supplies typed sections and rows. Save changed fields
  only, preserve disabled budget amounts, and retain section drafts during
  navigation and validation.
- **Activity:** grouping retains original events for debug inspection. Render
  expensive raw responses only when their inspector opens.
- **File preview:** format detection and reusable viewers belong to
  `features/file-preview/`, separate from Changes reads and navigation. See the
  [file-preview guide](../src/panel/features/file-preview/README.md) for rendering
  policy and limits.

For user-visible behavior and host scope rules, see the
[panel guide](panel-guide.md). For fixture scenarios and browser checks, see
[UI verification](ui-verification.md).

## Build and verification

`scripts/build-panel.mjs` produces self-contained HTML without runtime CDN
requests. It uses a separate build configuration from the development host and
rejects service, development and test code in the panel bundle. Make changes in the source files,
then rebuild to regenerate the HTML.

Follow [Local development](development.md#checks) for automated checks. Controller
and transport tests cover scope, races and lifecycle. Component tests cover
interactions and draft preservation. DOM and protocol tests do not establish
browser layout or native host placement. Use [UI verification](ui-verification.md)
for those checks.
