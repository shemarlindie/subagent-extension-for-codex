import { act } from "@testing-library/react";

import { CONNECTION } from "../../../../src/panel/app/state/connection";
import type { HostState } from "../../../../src/panel/app/state/types";
import type { Mounted } from "../base-state";
import type { Scenario } from "./scenario";

const displayMode =
  (mode: HostState["displayMode"]) =>
  async ({ transport }: Mounted) => {
    await act(async () => transport.setDisplayMode(mode));
  };

/** Changes the host and the connection report. */
export const hostScenarios: Scenario[] = [
  {
    label: "The connection status changes",
    group: "Host",
    change: async ({ transport }) => {
      await act(async () => transport.events.status(CONNECTION.reconnecting));
    },
  },
  {
    label: "The host's state changes",
    group: "Host",
    change: async ({ transport }) => {
      await act(async () =>
        transport.events.host({ ...transport.host, canSend: true }),
      );
    },
  },
  {
    label: "The panel switches to inline",
    group: "Host",
    change: displayMode("inline"),
  },
  {
    label: "The panel switches to picture in picture",
    group: "Host",
    change: displayMode("pip"),
  },
  {
    label: "The panel switches back to fullscreen",
    group: "Host",
    prepare: displayMode("inline"),
    change: displayMode("fullscreen"),
  },
  {
    label: "The panel's scope changes",
    group: "Host",
    change: async ({ controller }) => {
      await act(async () =>
        controller.applyScope({
          panel_scope: { conversation_id: null, repository: "/repo/b" },
        }),
      );
    },
  },
  {
    label: "The service errors",
    group: "Host",
    change: async ({ controller, transport }) => {
      const read = transport.tool.bind(transport);

      transport.tool = async <T>(
        name: string,
        args?: Record<string, unknown>,
      ) => {
        if (name === "app_wait_for_updates") {
          throw new Error("Service unavailable");
        }

        return read<T>(name, args);
      };

      await act(() => controller.refresh().catch(controller.report));
    },
  },
  {
    label: "The service asks for login",
    group: "Host",
    change: async ({ transport }) => {
      await act(async () => transport.events.login());
    },
  },
  {
    label: "The service disconnects",
    group: "Host",
    change: async ({ transport }) => {
      await act(async () => transport.events.status(CONNECTION.failed));
    },
  },
  {
    label: "The service reconnects",
    group: "Host",
    prepare: async ({ transport }) => {
      await act(async () => transport.events.status(CONNECTION.failed));
    },
    change: async ({ transport }) => {
      await act(async () => transport.events.status(CONNECTION.connected));
    },
  },
];
