import { act } from "@testing-library/react";
import { vi } from "vitest";

import type { Scenario } from "./scenario";

/** The panel's clocks, which the base state fakes. */
export const timerScenarios: Scenario[] = [
  {
    label: "A clock tick within a minute",
    group: "Timers",
    change: async () => {
      await act(async () => vi.advanceTimersByTime(1000));
    },
  },
  {
    label: "A clock tick that starts a new minute",
    group: "Timers",
    prepare: async () => {
      vi.setSystemTime(Date.now() + 59_000);
    },
    change: async () => {
      await act(async () => vi.advanceTimersByTime(1000));
    },
  },
];
