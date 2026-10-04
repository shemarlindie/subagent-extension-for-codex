import { Menu } from "@base-ui/react/menu";
import { useController, useSnapshot } from "./controller-context";
export function Header() {
  const controller = useController(),
    state = useSnapshot(),
    consoleMode = state.mode === "console",
    blocked = !state.connected || state.busy,
    expandLabel =
      state.host.displayMode === "fullscreen" ? "Collapse" : "Expand";
  const refresh = () => controller.run(() => controller.refresh()),
    expand = () =>
      controller.run(async () => {
        await controller.transport.expand?.();
      }),
    addProject = () => controller.addProject(),
    settings = () => controller.run(() => controller.settings());
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
        {/* Narrow panels swap these for the menu below; both stay mounted so CSS decides. */}
        <div className="toolbar toolbar-inline">
          <button
            id="refresh"
            className="quiet"
            aria-label="Refresh tasks"
            onClick={refresh}
          >
            ↻
          </button>
          {state.host.canExpand && (
            <button id="expand" className="quiet" onClick={expand}>
              {expandLabel}
            </button>
          )}
          <button
            id="add-project"
            className="quiet"
            disabled={blocked}
            onClick={addProject}
          >
            Add project
          </button>
          <button
            id="settings"
            className="quiet"
            disabled={blocked}
            onClick={settings}
          >
            Settings
          </button>
        </div>
        {/* The console header has room for every button, so only the panel gets the menu. */}
        {!consoleMode && (
          <Menu.Root>
            <Menu.Trigger
              className="quiet toolbar-menu"
              aria-label="More actions"
            >
              ⋯
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                className="menu-positioner"
                align="end"
                sideOffset={4}
              >
                <Menu.Popup className="menu-popup">
                  <Menu.Item className="menu-item" onClick={refresh}>
                    Refresh
                  </Menu.Item>
                  {state.host.canExpand && (
                    <Menu.Item className="menu-item" onClick={expand}>
                      {expandLabel}
                    </Menu.Item>
                  )}
                  <Menu.Item
                    className="menu-item"
                    disabled={blocked}
                    onClick={addProject}
                  >
                    Add project
                  </Menu.Item>
                  <Menu.Item
                    className="menu-item"
                    disabled={blocked}
                    onClick={settings}
                  >
                    Settings
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
        <button
          id="delegate"
          className="primary"
          disabled={blocked}
          onClick={() => controller.run(() => controller.delegate())}
        >
          {consoleMode ? "＋ Delegate" : "New task"}
        </button>
      </div>
    </header>
  );
}
