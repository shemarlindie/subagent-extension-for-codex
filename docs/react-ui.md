# React UI architecture

The delegation panel is the only UI. It runs embedded in a host and in a regular browser tab against the HTTP service. One entrypoint (`ui/entries/app.ts`) builds one page, `dist/app.html`. At runtime `ui/environment.ts` picks the transport from where the page renders (an iframe uses the host bridge, a top-level page with an injected API origin uses HTTP, `?preview=1` uses fixtures, anything else shows "Open through MCP"), and `ui/bootstrap.tsx` creates the controller and mounts the shell. Service APIs, MCP resources, standalone routes, and fixture preview remain the integration boundaries.

## Module boundaries

| Directory or file                                                               | Responsibility                                                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ui/core/types.ts`                                                              | UI snapshots, dialog variants, and the transport contract; task/event/artifact models reuse server types.             |
| `ui/core/controller.ts`                                                         | Async requests, refresh scheduling, selection, navigation, scope changes, and submission lifecycle.                   |
| `ui/core/initial-state.ts`, `ui/core/delegation.ts`, `ui/core/event-history.ts` | Route initialization, delegation defaults, and bounded event pagination.                                              |
| `ui/core/selectors.ts`                                                          | Pure derived values, filtering, formatting, and capability decisions.                                                 |
| `ui/transports/`                                                                | Console HTTP/SSE, MCP host bridge, and read-only fixture preview implementations.                                     |
| `ui/components/`                                                                | Focused presentation and interactions: task lists, status, actions, inspector sections, evidence tabs, and dialogs.   |
| `ui/forms/`                                                                     | Form drafts, validation, and explicit submission; reusable fields and footer live beside the forms.                   |
| `ui/shells/`                                                                    | Page composition.                                                                                                     |
| `ui/components/controller-context.tsx`                                          | Controller access and React subscriptions through `useSyncExternalStore`.                                             |
| `ui/styles/app.css`                                                             | The one stylesheet: an `@import` index over `theme.css`, `base.css`, `surfaces/` (layout) and `shared/` (components). |

The controller owns durable UI state and async coordination. Components subscribe to immutable snapshots and call controller actions. Forms own their editable drafts through React Hook Form, so polling does not replace field nodes or reset unsent input. Pure rendering components can receive props without needing controller access.

Use Base UI (`@base-ui/react`) primitives for dialogs, tabs (with an animated indicator), the task filter radio group, single and multiple selection, project suggestions, the settings accordion and its switches, including focus management and keyboard navigation. `SelectField` and `MultiSelectField` share dropdown structure and styling; `FormSelect` connects selection to React Hook Form. The project autocomplete accepts both registered projects and explicit absolute paths. Keep simple buttons, text inputs, and textareas as native controls. Base UI provides unstyled components; keep their styling in this project's stylesheets and application decisions in the controller/forms. React, React DOM, React Hook Form, and the official MCP Apps bridge supply existing infrastructure rather than custom equivalents.

Motion is short and quiet. Its purpose is to show what changed and to ease layout shifts. Timing tokens (`--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-out`) live in `ui/styles/shared/motion.css` and match `MOTION` in `ui/components/motion-utils.ts`. Base UI dialogs, popups, and collapsible panels animate through their `data-starting-style` and `data-ending-style` attributes. A collapsible panel uses the `collapse-panel` class and puts its padding and border on an inner element, so the height animation stays smooth. For other content, use the primitives in `motion.tsx` and the reduced-motion helpers in `motion-utils.ts`:

- `Presence` folds content in or out, or pops it, and keeps the last content mounted while it leaves.
- `useAnimatedHeight` eases a size change in place.
- `useListMotion` slides keyed rows to their new positions.
- `MotionContent` keys changing text or counts and applies a fade or rise without moving surrounding content.

Animations that run while the activity timeline measures positions change only opacity, so they never disturb its reading position. Reduced-motion preferences turn every animation off. The Web Animations helpers also skip animation where the API is missing, as in jsdom tests.

Banner messages use `Notice`, `CollapsibleNotice` and `NoticeText` from `ui/components/notice.tsx`. Pass `tone` (`warning`, the default, `error`, `info` or the accent-free `plain`) rather than adding a new banner class; the tone only changes the accent color in `.notice[data-tone]`. `NoticeText` clamps long text behind **Show more**. `ExpandableNotice` shows text as one clamped line that grows in place when toggled; text that already fits on one line has no toggle. Task descriptions use it.

Icons live in one catalog, `ICONS` in `ui/components/icons.tsx`. Render them with `<Icon name="bug" />` rather than inline `<svg>` markup. Every glyph uses the shared 24-unit viewBox and defaults to 16 px; pass `size` to override its rendered size. To add a glyph, include its tight geometry bounds, path data, optional shapes, and stroke width. Icons are decorative unless you pass `label`, and `className` and other SVG props pass through.

Use `<Chevron />` for compact dropdown and disclosure carets. It keeps a square layout footprint while preserving the caret's smaller drawn size.

Buttons use `<Button>` from `ui/components/button.tsx`, with a `variant`:

- `default`: the bordered secondary button beside a primary one, such as Cancel or Back.
- `primary`: the filled button that submits or confirms.
- `ghost`: borderless until hovered, for toolbar and navigation buttons.
- `text`: muted text with no box, for low-emphasis inline actions. Only this variant takes `underline`.

`type` defaults to `"button"`, so pass `type="submit"` for a form's submit button. Base UI parts that render their own button, such as `Dialog.Close` and `Menu.Trigger`, take `className={buttonClass("ghost")}`. Both themes style the variant classes (`primary`, `ghost`, `text-button`). Components with their own look, such as task rows and filter pills, keep a native `<button>` with their own class.

## Extending the UI

- Add a component when a section has a clear responsibility, reused presentation, or an independent interaction. Compose these sections in the inspector or shell; avoid moving networking or scope bookkeeping into JSX.
- Reuse the selection fields for new dropdowns and the existing project autocomplete for editable project suggestions. Keep primitive styling in the matching `ui/styles/shared/*.css` partial (listed in cascade order by `app.css`); define surface colors through CSS variables in `ui/styles/theme.css`, and put panel layout in `ui/styles/surfaces/`.
- Add a form for a new user-reviewed operation. Share fields and footers, declare its typed dialog variant, export a `defineDialog` definition (title, render, optional initial focus) from the form, and register it in `ui/forms/dialog-registry.ts`; `DialogHost` stays a generic shell. Submit through `controller.submit` to retain busy/error handling and the scope captured when the dialog opened. Send messages or execute tools only after the user submits.
- Add a selector for a pure calculation shared across views. Keep transport calls and mutation outside selectors.
- Add a transport when the connection mechanism changes. Implement `Transport` and deliver `TransportEvents`; select it in bootstrap. Rendering and forms should not branch on HTTP versus MCP tool envelopes.

Keep scope handling centralized. Changing the project or conversation invalidates outstanding reads and stale dialogs. A submission already in flight must not be silently repeated in the new scope. Task/detail generation checks discard delayed responses after selection changes, and disposal cancels refresh scheduling and connection resources.

## Console, host, and preview behavior

In a browser tab the page uses credentialed HTTP requests, token login, and SSE activity refreshes; the page has a single URL and no routes. Embedded views use the MCP Apps bridge for tools, theme variables, selection context, display modes, and optional message delivery. The host determines which actions are available (send, share, expand); opening the panel outside a host reports that MCP is required.

The embedded panel renders a compact summary in `inline` mode: project/chat scope, task counts, and the selected task's status. Counts cover the current scope even when the full panel has search or status filters applied. **Open panel** requests `fullscreen` when the host advertises it; the host controls placement. The full interface appears in expanded mode. Collapsing preserves task selection and hides any open dialog while retaining its draft for expansion. Scope changes still discard stale dialogs. A standalone browser tab and fixture preview always use the full layout.

Delegation forms collect the full request as the description without a manual title field. The service generates a title from the description's first line or sentence, up to 120 characters. Task rows and the inline preview show the concise title. The inspector shows the description as one line that expands in place and starts collapsed (a one-line description has no toggle). Interrupt and cancel confirmations start with the description expanded; retry confirmations keep it collapsed.

**Settings** opens the panel's settings dialog; the server does not advertise native host settings. `get_agent_settings` returns current `values`, the `defaults` a reset restores, and `sections` built by `src/core/settings-document.ts`. Each section has a stable `id`, a title, optional intro `help`, and typed rows: `select` with labelled options, `switch`, `budget` with a switch, amount, unit and bounds, or `models` with model and effort choices per scope and an `unsupported` effort flag. A model without discovered choices uses a text input. The dialog renders these rows as given; the JSON `schema` is for agents. `ui/forms/settings-layout.ts` holds the form logic.

Sections form an accordion: the first starts open, and opening another closes it. Collapsed sections summarize their values; model sections show only overrides. A badge counts edited rows. **Reset to defaults** appears in sections with nondefault values and resets only that section. Help parts are plain strings or `{ text, setting }` links to exact setting keys. A link names the target section in its tooltip, opens it and focuses the field; links within the current section stay plain text.

A disabled budget shows its remembered amount. Turning its switch on enables editing. Closed sections stay mounted for validation. Saving an invalid amount shows an error and opens its section; focus moves to the amount, or to its switch if disabled. Saving sends only changed fields through `update_agent_settings`, with budgets sent as switch and amount. Cancel, × and Escape ask before discarding unsaved edits. The dialog keeps its full available height as sections change, and its title and footer stay visible while the form scrolls.

Model selection shows each discovered model's display name with its description as secondary text. The delegation Model field remains free text, so custom IDs and aliases still work.

The activity timeline groups tool lifecycles and streamed responses. Consecutive artifact creations within one task show a count and their titles; thinking-token updates show **Thinking…** with a ticking clock while it is the latest activity, then **Thought for 7s** once something follows (`thinkingSpan`; only the clock ticks, through `useNow`). Other consecutive updates with the same event kind and summary share a row with an event count. Messages, failures, input requests, lifecycle transitions, and events without summaries keep separate rows. Routine status updates continue to share a row showing the latest status. Messages appear as cards while tools and status stay as compact rows, and fenced code blocks in message text render as code (no other markdown is interpreted). Each row's debug button, a Base UI collapsible, exposes every original event; grouping changes presentation only. Rows render through the reusable `Timeline`, `TimelineItem` and `TimelineDot` components in `ui/components/timeline.tsx`. They use Base UI's `useRender`, so each accepts a `render` prop and exposes its state as `data-trimmed`, `data-first`, `data-last` and `data-status` for styling.

Opening a row's debug details expands its newest raw response. Older responses stay collapsed initially, and manually changed disclosures survive refreshes and reopening the debug panel.

Opening the page outside an iframe with `?preview=1` selects fixture data; `&theme=dark` selects the dark preview theme. Preview does not connect to the service or execute workers. Unsupported fixture operations fail explicitly, and projects added in it are not remembered. Native host rendering and delivery still require separate host verification.

Use `?preview=1` to look at built HTML without a dev server. For panel work, use the panel dev host (`npm run dev:ui`): it runs the panel through the real host bridge, with thread or global launches and host capabilities, while `?preview=1` always opens the panel in global scope with no host.

![Fixture preview with a selected task and artifact report](images/react-panel-preview.png)

![Fixture preview showing project selection and a pending permission request](images/react-project-picker.png)

## Panel dev host

`npm run dev:ui` runs the panel inside a mock MCP Apps host with hot reload, against fixtures or the live service. See [Local development](development.md#panel-dev-host).

## Build and verification

`scripts/build-ui.mjs` bundles the entrypoint with Vite's build API (one minified ES module, the automatic JSX runtime through `@vitejs/plugin-react`, and `process.env.NODE_ENV="production"`). It does not read `vite.config.ts`, which configures only the dev host. It embeds JavaScript and CSS into `dist/app.html`, preserving self-contained HTML delivery without runtime CDN requests. The build also parses the final embedded module with Vite's `parseAst` to catch template replacement corruption. Edit source files, then rebuild; generated HTML is not the source of truth. Run `npm run typecheck` and `npm test` as described in [Local development](development.md#checks).

Typechecking covers server TypeScript, the browser/TSX configuration in `ui/tsconfig.json`, and the tests and Vite configs through `tsconfig.test.json`. The test suite includes controller scope/race/lifecycle checks, HTTP and host transport contracts, and React Testing Library/user-event interactions in Vitest's jsdom environment. React interaction tests cover keyboard tabs, dialog focus restoration, draft preservation through refresh, budgets, worker input, explicit handoff submission, and literal text rendering. Existing HTTP/MCP and generated-panel checks remain relevant. Automated DOM/protocol checks do not establish actual browser layout or native host placement; verify those separately for changes affecting them.
