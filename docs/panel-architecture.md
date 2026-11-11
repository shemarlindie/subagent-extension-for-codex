# Panel architecture

Use this guide when you change the React panel, its state or its transports.

- [The panel guide](panel-guide.md) describes user-visible behavior.
- [UI verification](ui-verification.md) covers browser checks.
- [Architecture](architecture.md) covers the service and shared code boundaries.

The embedded MCP App and the standalone console share one React application.
Bootstrap (`app/bootstrap.tsx`) picks the host bridge or HTTP transport, and
rendering and forms use the same controller for both. The production build
embeds the application in `dist/app.html` without development fixtures.

The page loads nothing beyond itself and the service API. The embedded panel
declares no external domains in its MCP App metadata, and the service sends the
standalone console a matching Content Security Policy. Keep scripts, styles,
fonts and images inline, and don't load remote content that a worker could name.

## Module boundaries

Paths in this guide are relative to `src/panel/` unless they start with `src/`
or `dev/`.

| Area          | Responsibility                                                     |
| ------------- | ------------------------------------------------------------------ |
| `app/`        | Application composition, navigation, state and async coordination. |
| `features/`   | Domain UI, actions, selectors and feature styles.                  |
| `shared/`     | Reusable primitives, dialogs, forms and cross-feature helpers.     |
| `transports/` | HTTP/SSE and MCP bridge connections behind a common contract.      |
| `dev/panel/`  | Fixtures and the mock host, excluded from production.              |

The panel imports browser-safe contracts and domain functions from
`src/shared/<feature>/`, never service modules. See
[Architecture](architecture.md#code-ownership) for that boundary.

Keep helpers, focused tests and styles beside the feature or component they
serve. Global tokens and resets live in `styles/`, and application layouts in
`app/styles/`. `styles/app.css` imports production CSS in cascade order.

Some features have boundaries worth knowing:

- **Changes** (`features/changes/`) owns change reads, file selection, worktree
  actions and the Changes tab. File viewers stay in `features/file-preview/` so
  other views can reuse them.
- **Unread** (`features/tasks/unread/`) owns read tracking. The service stores
  read state. The panel updates the list optimistically and reconciles on
  refresh. Chat records only content it has loaded and shown at the latest
  position. Keep reading position and the unread divider coordinated, so
  incoming events never move a reader through history or briefly mark an open
  task unread.

## State ownership and component patterns

`Controller` (`app/state/controller.ts`) owns scope, selection and async
coordination, and delegates feature work to loaders and actions.
`TaskDetailLoader` (`features/tasks/task-detail-loader.ts`) merges Chat and
Activity from the panel's views and reads turn history. The controller retains
selection generations and scope invalidation, which make outdated detail reads
obsolete. Components use these entry points:

- `controller.taskActions` runs task mutations.
- `controller.newTasks` runs the new-task composer.
- `controller.submit` submits dialogs.
- `controller.session` holds session memory.
- `controller.undo` holds the undo history and the undo toast's notice.

Components read the immutable snapshot with `useSnapshot` and call controller
actions. The hook rerenders a component only when its selection changes, so
select the fields it renders, usually by name, as in
`const { busy, dialog } = useSnapshot(["busy", "dialog"])`. Lint requires
destructuring the result, so it flags a field the component no longer reads. A
helper that takes several fields gets them as its own selection of a named field
constant, such as `useSnapshot(TASK_LIST_FIELDS)`. An event handler that needs
state only when the user acts reads `controller.getSnapshot()`. Patches keep the
references of unchanged read data, listed in `READ_FIELDS` in
`app/state/patch-state.ts`, so a refresh renders only what changed. Pure
rendering components can take props directly. Transport revisions and draft
following stay outside rendering.

Components read session memory with `useSessionState(scope, id, select?)` and
write partial updates. Select stable fields or references to avoid unrelated
rerenders. Scroll hooks update stable reading cells without notifying on every
scroll. Answered questions clear their entry.

Forms keep editable drafts in React Hook Form, so refreshes preserve field nodes
and unsent input. Use Base UI (`@base-ui/react`) with project styling for
dialogs, tabs, selection, autocomplete and switches. Keep simple buttons, text
inputs and textareas native, except the shared Base UI search field. Reuse the
shared selection fields and `TabList` for consistent keyboard and focus
behavior. Keep search text separate from selected values in lookup fields. When
selection can change outside a tab strip, reveal the selected tab without
scrolling its parent.

### New-task composer

The composer (`features/delegation/new-task/`) and the Advanced task dialog
share settings reads, task defaults, submission policy and task-start arguments.
Their read progress and retry logic live in
`features/delegation/delegate-reads.ts`. Keep their intentional profile
difference. The composer starts with Implementer, and Advanced task starts with
the default worker profile from settings.

The composer's model and reasoning chips save each choice as the selected
profile's default setting. `useProfileChoice` sets the field and calls
`controller.newTasks.saveProfileSetting`, which updates the composer's loaded
defaults and calls `update_settings`. A failed save restores the loaded default
unless a later choice replaced it, and shows as the form's `root.settings`
error. The permission mode stays per task. See
[Configuration](configuration.md#task-defaults) for the profile settings.

The project chip's **Add project…** opens the Add project dialog marked
`forNewTask`. After registration, the controller passes the project to
`controller.newTasks.projectAdded`, and the chip selects it, so the task list
keeps its scope.

## Motion

Motion shows what changed and eases layout shifts. Reuse the primitives in
`shared/components/motion/` for presence, keyed lists, height changes and
changing text. Keep the JavaScript `MOTION` values and their matching CSS tokens
in sync. Loading timing has its own configuration.

- Use Base UI's transition attributes for its popups and collapsible panels.
- Keep padding and borders inside a collapsing panel so they don't disturb its
  height animation.
- Give children animated by `useAutoList` their own layout boxes, without
  `Presence` wrappers.
- Make controls inert while they leave.

Animations must preserve reading position. Use opacity for arrival fades in
measured timelines. Avoid row transforms, which can distort measurements and
grow the scroll area. Chat eases message height changes and reports intermediate
sizes to `useReadingScroll`, which glides to the new end while following
overflowing content. Respect reduced-motion preferences. Skip animation when the
Web Animations API is unavailable, including in tests.

## Loading and pending UI

Show feedback as soon as a read is pending. Keep the surrounding layout,
navigation, labels and known values visible, and keep still-valid content on
screen with progress beside it.

- When the content's structure is known, show a skeleton that matches it. Each
  feature builds its own skeleton layouts from shared `SkeletonShape` blocks.
- When layouts vary widely, as with file previews, show a centered spinner.

Use `SkeletonShape`'s text measurement helpers with the same typography and
width as the loaded content, so placeholders reserve realistic space. Plain
shapes suit icons and controls. `LOADING_SKELETON_CONFIG` sets the delay that
avoids flashes on fast reads and the minimum time a shown skeleton stays
visible.

Use `LoadingSwap` to hand off from a placeholder to content. It keeps the same
instance mounted through loading and readiness, and hides its inactive layer and
makes it inert. Keep task navigation mounted while task and tab reads finish in
place. Restore saved reading positions before revealing content. Avoid duplicate
status announcements when a parent already announces loading.

Forms and dialogs render their known structure immediately and finish async
reads in place, with stable labels, help text and control geometry. Show a
pending control like this:

- Input or textarea: `AsyncControl` overlays a spinner.
- Toggle: `FormSwitch` shows the pending state.
- Select with an unresolved value or options: `SelectField` with `loading`
  replaces its caret with a spinner and announces loading.

If a value is known but another pending read blocks editing, keep the value
visible and disable the control without a spinner. Disable actions that depend
on pending data and leave unrelated controls responsive. Replace failed reads
with local error and retry UI.

Turn on [Slow async reads](ui-verification.md#scope-and-host-controls) to
inspect pending states in the fixture UI.

## Shared controls

- `SearchField` shares Base UI input and clear-button controls between task and
  settings search. It clears on Escape and restores focus after clearing. Its
  `/` shortcut focuses the field on the visible page, and an inline key hint
  shows while the field is empty and unfocused. Tasks also blur on Escape when
  empty.
- `Notice` shows banner messages, and `NoticeText` shows expandable long text.
  Keep shared presentation out of feature-specific banner classes.
- `Icon` renders the shared icon catalog, and `Chevron` renders compact carets.
  Icons are decorative unless given a label.
- `TooltipWrapper` labels controls for mouse and keyboard users. Base UI turns
  tooltips off for touch, so use `Infotip` for info triggers whose note must
  open on tap.
- `Button` variants cover primary, secondary, toolbar and inline actions. Pass
  `type="submit"` explicitly for form submission. Base UI button parts can reuse
  `buttonClass`. Domain controls such as task rows may keep their own native
  buttons and styles.

## Page navigation

`app/navigation/pages.ts` defines each page's identity, availability and
retention. The controller guards user-requested page changes:

- Tasks and Settings are available in chat and global scope.
- Projects needs a connected, resolved global scope.
- Busy work and open modal dialogs block navigation.
- A host scope change into a chat moves a global-only page back to Tasks and
  invalidates stale dialogs.

`PageOutlet` renders the registered pages. Tasks stays mounted while inactive to
preserve drafts and reading positions, with its container hidden and inert.
Projects and Settings unmount when you leave. The outlet restores focus to the
control that had it when you return to a retained page.

`PageFrame` provides a labeled full-width section, heading focus on entry, a
back control (`BackButton`) and actions. The Tasks page owns task selection and
inspector tabs. Add project and removal confirmation stay dialogs.

To add a page:

1. Declare its identity, label, scope requirement, retention policy and fallback
   focus target in `pages.ts`.
2. Add its component to the outlet's typed component map.
3. Keep its content in the owning feature, and use `PageFrame` when it has a
   heading and toolbar.
4. Navigate through the controller so the scope, busy and dialog guards apply.
5. Test its availability, URL restoration, lifetime and focus behavior.

## Extending the UI

- **Component:** add one when a section has a clear responsibility, reused
  presentation or an independent interaction. Compose sections in the inspector
  or shell. Keep networking and scope bookkeeping out of JSX.
- **Dropdown:** reuse the selection fields, and the project autocomplete for
  editable project suggestions. Pass `appearance="inline"` for a borderless
  trigger that reads as text, like the header's project scope.
- **Styles:** keep primitive styling beside its component or dialog. Define
  surface colors through CSS variables in `styles/theme.css`, and put panel
  layout in `app/styles/`.
- **Form:** add one for a new user-reviewed operation. Share fields and footers,
  declare its typed dialog variant, and export a `defineDialog` definition from
  the form with its title, render function, optional title-row controls and
  initial focus. Register it in `shared/dialogs/dialog-registry.ts`.
  `DialogHost` stays a generic shell. Submit through `controller.submit` to keep
  busy and error handling and the scope captured when the dialog opened. Send
  messages or run tools only after the user submits.
- **Undoable action:** remember each deliberate user change in
  `controller.undo`, or the action context's `undo`. Use `track` when the panel
  shows the change before the service confirms it, so the shortcut never skips
  past a change still saving to an older one. Use `record` for changes shown
  only after success. Steps call service tools or session memory with the values
  captured before the change, never component state, and reject with a message
  the user can read. Set `toast` only when the change takes something off the
  screen, list a bulk change's `items`, and give a `view` such as `taskView`
  when the label doesn't name what changed. Views with their own reads, such as
  a project's archive, read again when `undoRevision` changes. Don't record
  automatic changes, such as Chat marking a task read, or changes that start
  work or reach the worker.
- **Selector:** add one for a pure calculation shared across views. Keep
  transport calls and mutations out of selectors.
- **Transport:** add one when the connection mechanism changes. Implement
  `Transport`, deliver `TransportEvents` and select it in bootstrap. Rendering
  and forms must not branch on HTTP versus MCP tool envelopes.

Keep scope handling in the controller. Task and detail generation checks discard
delayed responses after selection changes, and disposal cancels refresh
scheduling and connection resources.

## State and persistence

The controller keeps session memory apart from view state that can survive a
reload.

- **Session memory:** `controller.session` (`app/state/session/`) holds per-task
  tabs, composer visibility, reading positions, opened and viewed files in
  Changes, question answers and new-task options. It lasts until the controller
  is replaced.
- **Reload state:** the standalone console and the development host keep view
  choices (page, project, task, new-task view, filter, search and tab) in the
  browser URL. They keep open dialog descriptors, form drafts and the last
  Settings section in browser storage. Unsent task and new-task composer text
  also stays in browser storage until sent or cleared.
- **Task list width and collapsed project groups:** saved in browser storage
  wherever it is available. Groups expanded with **Show more** stay expanded
  while the project groups are shown.
- **Composer model and reasoning:** saved on the service as profile settings.
  See [New-task composer](#new-task-composer).

`app/view-state.ts` provides the reload adapters, and `app/bootstrap.tsx`
installs them for the standalone console and the development host. The
development host mirrors view choices into its outer URL. The production
embedded panel has no adapter, so its view choices and dialog drafts last only
while its controller stays mounted. `app/state/persistence/` validates and
restores saved dialogs from the freshly loaded projects and tasks. Settings and
Advanced task restore through `DialogLoader`, which owns their reads, errors and
retries.

- Conversation IDs and authentication tokens are never saved as view state or
  drafts.
- Restoring reloads server data.
- Closing or submitting a dialog removes its saved descriptor. Settings stays
  open after saving and updates its draft baseline.
- Changing scope invalidates outstanding reads and closes stale dialogs. The
  panel never repeats a submitted mutation.
- Collapsing the embedded panel hides dialogs and keeps their drafts for when it
  expands.

## Feature integration points

- **Chat:** browser-safe conversation functions in
  `src/shared/tasks/conversation/` serve both the service and the preview. Task
  actions own send, queue and interrupt. Transports deliver streamed drafts
  separately from stored messages. `DraftFollower` keeps completed streamed and
  task-list drafts shown until Chat holds the stored message, or until a Chat
  read that started later finds none, so a finished reply never disappears in
  between. A view's list and Chat come from one service snapshot, so the Chat in
  the view whose list ends a draft already counts as later.
- **Settings:** the service supplies typed sections and rows. Save only changed
  fields, preserve disabled budget amounts, and keep section drafts during
  navigation and validation. Search and browsing share mounted controls to
  retain drafts and field identity. Search matches metadata independently of
  draft values, so editing a result keeps it in place. Synonyms come from each
  setting schema's `keywords` metadata.
- **Activity:** grouping keeps the original events for debug inspection. Render
  event data only when its inspector opens. Original responses load from the
  service while that inspector is open and are released when it closes.
- **File preview:** `features/file-preview/` owns format detection and reusable
  viewers. See the
  [file-preview guide](../src/panel/features/file-preview/README.md) for
  rendering policy and limits.

## Build and verification

`scripts/build-panel.mjs` builds self-contained HTML with no runtime CDN
requests. It uses its own build configuration, separate from the development
host, and rejects service, development and test code in the bundle. Edit the
source files and rebuild to regenerate the HTML.

Follow [Local development](development.md#checks) for automated checks.
Controller and transport tests cover scope, races and lifecycle. Component tests
cover interactions and draft preservation. These tests don't establish browser
layout or native host placement, so use [UI verification](ui-verification.md)
for those.
