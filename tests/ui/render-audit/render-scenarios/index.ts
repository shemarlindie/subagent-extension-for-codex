import { hostScenarios } from "./host";
import { oneOffScenarios } from "./one-off";
import { readScenarios } from "./reads";
import type { Scenario } from "./scenario";
import { streamingScenarios } from "./streaming";
import { timerScenarios } from "./timers";
import { typingScenarios } from "./typing";

const groups = [
  readScenarios,
  streamingScenarios,
  hostScenarios,
  timerScenarios,
  typingScenarios,
  oneOffScenarios,
];

/** Read, streaming and typing scenarios again in the other layouts. */
const layouts = (["narrow", "scoped"] as const).flatMap((layout) =>
  [readScenarios, streamingScenarios, typingScenarios]
    .flat()
    .filter((scenario) => !scenario.layout)
    .map((scenario) => ({
      ...scenario,
      label: `${scenario.label} (${layout})`,
      layout,
    })),
);

/** Every scenario, in report order. */
export const scenarios: Scenario[] = [...groups.flat(), ...layouts];

/** The scenario with this label, which guards assert on. */
export function scenario(label: string) {
  const found = scenarios.find((each) => each.label === label);
  if (!found) throw new Error(`No scenario named ${label}`);

  return found;
}
