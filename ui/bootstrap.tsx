import { createRoot } from "react-dom/client";
import { Controller } from "./core/controller";
import type { Mode } from "./core/types";
import { HostTransport } from "./transports/host";
import { ConsoleTransport } from "./transports/console";
import { PreviewTransport } from "./transports/preview";
import { ControllerContext } from "./components/controller-context";
import { AppShell } from "./shells/app-shell";
export function mount(mode: Mode) {
  const embedded = window.parent !== window;
  const preview =
    !embedded && new URLSearchParams(location.search).get("preview") === "1";
  const transport = preview
    ? new PreviewTransport()
    : embedded || mode === "panel"
      ? new HostTransport(undefined, mode === "console")
      : new ConsoleTransport(
          (window as Window & { CODEX_SUBAGENT_EXTENSION_ORIGIN?: string })
            .CODEX_SUBAGENT_EXTENSION_ORIGIN ?? location.origin,
        );
  const controller = new Controller(transport, mode);
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <ControllerContext.Provider value={controller}>
      <AppShell />
    </ControllerContext.Provider>,
  );
  if (mode === "panel" && !embedded && !preview) controller.showHostRequired();
  else void controller.start();
  window.addEventListener(
    "pagehide",
    () => {
      controller.dispose();
      root.unmount();
    },
    { once: true },
  );
}
