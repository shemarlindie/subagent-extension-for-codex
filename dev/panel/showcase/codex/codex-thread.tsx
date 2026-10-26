import "./codex.css";

import type { StoryStep } from "../story";
import { CodexComposer } from "./codex-composer";
import { CodexThreadItem } from "./codex-thread-item";

type CodexThreadProps = { steps: StoryStep[] };

/** Codex's conversation column up to the current step. */
export function CodexThread({ steps }: CodexThreadProps) {
  const working = steps.at(-1)?.working;

  return (
    <section className="codex-thread" aria-label="Codex">
      <div className="codex-scroll">
        <div className="codex-items">
          {steps.flatMap((step, s) =>
            step.codex.map((item, i) => (
              <CodexThreadItem key={`${s}-${i}`} item={item} />
            )),
          )}
          {working && <div className="codex-working">{working}</div>}
        </div>
      </div>
      <CodexComposer working={!!working} />
    </section>
  );
}
