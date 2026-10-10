# React UI architecture

Delegated Work is the only UI. It runs embedded in a host and in a regular browser tab against the HTTP service. One entrypoint (`src/panel/app/app.ts`) builds one page, `dist/app.html`. At runtime `src/panel/app/environment.ts` picks the transport from where the page renders (an iframe uses the host bridge, a top-level page with an injected API origin uses HTTP, anything else shows "Open through MCP"), and `src/panel/app/bootstrap.tsx` creates the controller and mounts the shell. Fixtures exist only in development, through the panel dev host; `scripts/build-panel.mjs` fails the build if fixtures or the dev host reach the production bundle. Service APIs, MCP resources, and standalone routes remain the integration boundaries.

## Module boundaries

| Directory or file                                                   | Responsibility                                                                                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/panel/app/`                                                    | Entrypoints, environment selection, page shell, and HTML template.                                                                                                            |
| `src/panel/features/tasks/`                                         | Task list, inspector, Chat, activity, evidence, and task-control subfeatures.                                                                                                 |
| `src/panel/features/file-preview/`                                  | File previews: format detection and the code, Markdown, table, diff and image viewers, used by the Changes tab; Chat and Activity share the Markdown view.                    |
| `src/panel/features/projects/`, `delegation/`, `settings/`, `auth/` | Project registration and scope, task delegation, settings, and login.                                                                                                         |
| `src/panel/app/state/`                                              | Application controller coordination, persisted UI state, composed snapshots, selector exports, and React context. Feature-owned types and selectors stay with their features. |
| `src/panel/shared/components/`, `dialogs/`, `forms/`, `utils/`      | Reusable UI primitives and cross-feature helpers, including persisted dialog-form state.                                                                                      |
| `src/panel/transports/`                                             | Console HTTP/SSE and MCP host bridge transports and their contracts.                                                                                                          |
| `dev/panel/scenarios/`, `dev/panel/host/`                           | Development fixtures and the mock MCP Apps host; excluded from production bundles.                                                                                            |
| `src/panel/styles/app.css`                                          | Global stylesheet index; feature styles live beside their feature modules.                                                                                                    |
| Co-located `*.test.ts`; `tests/integration/`                        | Focused tests sit by the modules; cross-feature and environment tests stay in the integration suite.                                                                          |

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

Application state groups dialog descriptors and restoration in
`app/state/persistence/`, and in-memory session state and hooks in
`app/state/session/`. Transport size tracing stays with `transports/`.

The controller owns UI state and async coordination. Components subscribe to immutable snapshots and call controller actions. Forms own their editable drafts through React Hook Form, so polling does not replace field nodes or reset unsent input. Pure rendering components can receive props without needing controller access. Feature and component tests live beside those modules; the Vitest and TypeScript test configurations discover them separately from production builds.

Components read session memory with `useSessionState(scope, id, select?)` and
partial updates. Select a stable field/reference to avoid unrelated rerenders.
Scroll hooks mutate stable reading cells without notifying on every scroll;
answered questions clear their entry. See [State and persistence](#state-and-persistence)
for lifetime and storage boundaries.

Use Base UI (`@base-ui/react`) primitives for dialogs, tabs (with an animated indicator), the task filter radio group, single and multiple selection, project suggestions, the settings accordion and its switches, including focus management and keyboard navigation. `SelectField` and `MultiSelectField` share dropdown structure and styling; `FormSelect` connects selection to React Hook Form. The project autocomplete accepts both registered projects and explicit absolute paths. Keep simple buttons, text inputs, and textareas as native controls. Base UI provides unstyled components; keep their styling in this project's stylesheets and application decisions in the controller/forms. React, React DOM, React Hook Form, and the official MCP Apps bridge supply existing infrastructure rather than custom equivalents.

Motion is short and quiet. Its purpose is to show what changed and to ease layout shifts. Timing tokens (`--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-out`) live in `src/panel/shared/components/motion/motion.css` and match `MOTION` in `src/panel/shared/components/motion/motion-utils.ts`. Base UI dialogs, popups, and collapsible panels animate through their `data-starting-style` and `data-ending-style` attributes. A collapsible panel uses the `collapse-panel` class and puts its padding and border on an inner element, so the height animation stays smooth. For other content, use the primitives in `src/panel/shared/components/motion/motion.tsx` and the reduced-motion helpers in `src/panel/shared/components/motion/motion-utils.ts`:

- `Presence` folds content in or out, or pops it, and keeps the last content mounted while it leaves.
- `useAnimatedHeight` eases a size change in place.
- `useListMotion` slides keyed rows to their new positions.
- `MotionContent` keys changing text or counts and applies a fade or rise without moving surrounding content.

Animations that run while the activity timeline measures positions change only opacity, so they never disturb its reading position. Reduced-motion preferences turn every animation off. The Web Animations helpers also skip animation where the API is missing, as in jsdom tests.

Banner messages use `Notice`, `CollapsibleNotice` and `NoticeText` from `src/panel/shared/components/notice/notice.tsx`. Pass `tone` (`warning`, the default, `error`, `info` or the accent-free `plain`) rather than adding a new banner class; the tone only changes the accent color in `.notice[data-tone]`. `NoticeText` clamps long text behind **Show more**. `ExpandableNotice` shows text as one clamped line that grows in place when toggled; text that already fits on one line has no toggle.

Icons live in one catalog, `ICONS` in `src/panel/shared/components/icons/icons.tsx`. Render them with `<Icon name="bug" />` rather than inline `<svg>` markup. Every glyph uses the shared 24-unit viewBox and defaults to 16 px; pass `size` to override its rendered size. To add a glyph, include its tight geometry bounds, path data, optional shapes, and stroke width. Icons are decorative unless you pass `label`, and `className` and other SVG props pass through.

Use `<Chevron />` for compact dropdown and disclosure carets. It keeps a square layout footprint while preserving the caret's smaller drawn size.

Buttons use `<Button>` from `src/panel/shared/components/button/button.tsx`, with a `variant`:

- `default`: the bordered secondary button beside a primary one, such as Cancel or Back.
- `primary`: the filled button that submits or confirms.
- `ghost`: borderless until hovered, for toolbar and navigation buttons.
- `text`: muted text with no box, for low-emphasis inline actions. Only this variant takes `underline`.

`type` defaults to `"button"`, so pass `type="submit"` for a form's submit button. Base UI parts that render their own button, such as `Dialog.Close` and `Menu.Trigger`, take `className={buttonClass("ghost")}`. Both themes style the variant classes (`primary`, `ghost`, `text-button`). Components with their own look, such as task rows and filter pills, keep a native `<button>` with their own class.

## Extending the UI

- Add a component when a section has a clear responsibility, reused presentation, or an independent interaction. Compose these sections in the inspector or shell; avoid moving networking or scope bookkeeping into JSX.
- Reuse the selection fields for new dropdowns and the existing project autocomplete for editable project suggestions. Keep primitive styling beside its component or dialog (listed in cascade order by `src/panel/styles/app.css`); define surface colors through CSS variables in `src/panel/styles/theme.css`, and put panel layout in `src/panel/app/styles/`.
- Add a form for a new user-reviewed operation. Share fields and footers, declare its typed dialog variant, export a `defineDialog` definition (title, render, optional title-row controls and initial focus) from the form, and register it in `src/panel/shared/dialogs/dialog-registry.ts`; `DialogHost` stays a generic shell. Submit through `controller.submit` to retain busy/error handling and the scope captured when the dialog opened. Send messages or execute tools only after the user submits.
- Add a selector for a pure calculation shared across views. Keep transport calls and mutation outside selectors.
- Add a transport when the connection mechanism changes. Implement `Transport` and deliver `TransportEvents`; select it in bootstrap. Rendering and forms should not branch on HTTP versus MCP tool envelopes.

Keep scope handling centralized. Task/detail generation checks discard delayed responses after selection changes, and disposal cancels refresh scheduling and connection resources. See [State and persistence](#state-and-persistence) for scope changes and dialog lifetime.

## State and persistence

The controller separates session memory from recoverable view state:

- `controller.session` stores per-task tabs, composer drafts/visibility, reading
  positions (including Changes' opened files), viewed changed files, and
  question answers until the controller is replaced.
- Browser URL state stores scope, selected task/list, tab, search and status
  filter. The dev host mirrors it into its outer URL; Codex has no URL-state
  bridge. Search and form drafts persist after a 250 ms debounce, flushed on
  page exit.
- Boolean `dw_dlg_<name>=1` flags record open dialogs. Ordered descriptors and
  compatible form drafts live in local storage. The newest dialog restores
  first. Closing or successful submission removes its descriptor and draft.
  Server-owned data is reloaded; authentication tokens are never form drafts.

Changing scope invalidates outstanding reads and closes stale dialogs. A
submitted mutation is never repeated automatically. Collapsing the embedded
panel hides dialogs while preserving their drafts for expansion.

## Feature integration points

- **Chat:** `src/shared/tasks/conversation/chat.ts` supplies `chatItems` to both the service
  and preview. `mergeChat` updates repeated items in place. HTTP transports use
  SSE drafts; host transports use chained `get_user_agent_draft` reads. The
  controller handles queue/send/interrupt actions and inline failures.
- **Settings:** `src/shared/settings/settings-document.ts` supplies typed
  sections and rows. `src/panel/features/settings/settings-layout.ts` owns form logic.
  Save only changed fields; preserve disabled budget amounts. Closed sections
  remain mounted for validation, and invalid fields open their section.
- **Activity:** grouping and presentation retain original events for debug
  inspection. `Timeline`, `TimelineItem` and `TimelineDot` use Base UI `useRender`
  and expose state attributes for styling. Expensive raw response rendering
  starts only when its inspector opens.
- **File preview:** `src/panel/features/file-preview/` owns format detection and
  Markdown, source, diff, table and image views. Render the whole file with
  deferred row blocks for large content. Syntax highlighting stops above
  200,000 characters; SVG images over 64 KiB show as source only.

For user-visible behavior and host scope rules, see the
[panel guide](codex-panel.md). For fixture scenarios and browser checks, see
[UI verification](ui-verification.md).

## Build and verification

`scripts/build-panel.mjs` bundles the entrypoint with Vite's build API (one minified ES module, the automatic JSX runtime through `@vitejs/plugin-react`, and `process.env.NODE_ENV="production"`). It does not read `vite.config.ts`, which configures only the dev host. It embeds JavaScript and CSS into `dist/app.html`, preserving self-contained HTML delivery without runtime CDN requests. The build also parses the final embedded module with Vite's `parseAst` to catch template replacement corruption. Edit source files, then rebuild; generated HTML is not the source of truth. Run `npm run typecheck` and `npm test` as described in [Local development](development.md#checks).

Typechecking covers server TypeScript, the browser/TSX configuration in `tsconfig.panel.json`, and the tests and Vite configs through `tsconfig.test.json`. The test suite includes controller scope/race/lifecycle checks, HTTP and host transport contracts, and React Testing Library/user-event interactions in Vitest's jsdom environment. React interaction tests cover keyboard tabs, dialog focus restoration, draft preservation through refresh, budgets, worker input, the Chat composer's keys, queue controls and budget raise, explicit handoff submission, and literal text rendering. Existing HTTP/MCP and generated-panel checks remain relevant. Automated DOM/protocol checks do not establish actual browser layout or native host placement; verify those separately for changes affecting them.
