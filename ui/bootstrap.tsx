import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";

import { ControllerContext } from "./components/controller-context";
import { Controller } from "./core/controller";
import { traceSize } from "./core/size-trace";
import { detectEnvironment } from "./environment";
import { AppShell } from "./shells/app-shell";
import { ConsoleTransport } from "./transports/console";
import { HostTransport } from "./transports/host";

export function mount() {
  const environment = detectEnvironment();

  // DEBUG: Timestamp startup before the host bridge connects or React renders.
  if (environment.kind === "host") traceSize("bootstrap-start");

  // Only a host supplies a theme; a standalone page follows the system setting.
  if (environment.kind === "http") {
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyDocumentTheme(scheme.matches ? "dark" : "light");
    apply();
    scheme.addEventListener("change", apply);
  }

  const transport =
    environment.kind === "http"
      ? new ConsoleTransport(environment.origin)
      : new HostTransport();

  const controller = new Controller(transport);
  const root = createRoot(document.getElementById("root")!);

  root.render(
    <ControllerContext.Provider value={controller}>
      <AppShell />
    </ControllerContext.Provider>,
  );

  if (environment.kind === "unsupported") controller.showHostRequired();
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
