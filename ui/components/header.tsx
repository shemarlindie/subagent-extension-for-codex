import { useController, useSnapshot } from "./controller-context";
export function Header() {
  const controller = useController(),
    state = useSnapshot(),
    consoleMode = state.mode === "console";
  return (
    <header>
      <div className="brand">
        <span className="mark" aria-hidden="true">
          ⌘
        </span>
        {consoleMode ? (
          <h1>
            Codex subagent extension <span>Delegated work, in one place</span>
          </h1>
        ) : (
          <strong>Delegated work</strong>
        )}
      </div>
      <span className="grow" />
      <div className="toolbar">
        <span id="connection" className="connection muted" role="status">
          {state.connection}
        </span>
        <button
          id="refresh"
          className="quiet"
          aria-label="Refresh tasks"
          onClick={() => controller.run(() => controller.refresh())}
        >
          ↻
        </button>
        {state.host.canExpand && (
          <button
            id="expand"
            className="quiet"
            onClick={() =>
              controller.run(async () => {
                await controller.transport.expand?.();
              })
            }
          >
            {state.host.displayMode === "fullscreen" ? "Collapse" : "Expand"}
          </button>
        )}
        <button
          id="delegate"
          className="primary"
          disabled={!state.connected || state.busy}
          onClick={() => controller.run(() => controller.delegate())}
        >
          {consoleMode ? "＋ Delegate" : "New task"}
        </button>
      </div>
    </header>
  );
}
