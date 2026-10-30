import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";

import { ConsoleTransport } from "../transports/console";
import { HostTransport } from "../transports/host";
import { applyBodyLayout, AppShell } from "./app-shell";
import { detectEnvironment, type Environment } from "./environment";
import { Controller } from "./state/controller";
import { ControllerContext } from "./state/controller-context";
import { browserUiState, embeddedDevHostUiState } from "./view-state";

function viewStateFor(environment: Environment) {
  if (environment.kind === "http") return browserUiState();
  if (environment.kind === "host") return embeddedDevHostUiState();

  return undefined;
}

export function mount() {
  const environment = detectEnvironment();

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

  const viewState = viewStateFor(environment);

  const controller = new Controller(transport, undefined, viewState);

  applyBodyLayout(controller.getSnapshot(), transport.embedded);
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
      viewState?.flush?.();
      controller.dispose();
      root.unmount();
    },
    { once: true },
  );
}
