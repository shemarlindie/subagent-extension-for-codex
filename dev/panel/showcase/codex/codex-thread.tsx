import "./codex.css";

import type { StoryStep } from "../story";
import type { CodexEmbed } from "./codex-app-item";
import { CodexComposer } from "./codex-composer";
import { CodexThreadItem } from "./codex-thread-item";

type CodexThreadProps = {
  steps: StoryStep[];
  /** The app the latest step is opening inline. */
  embed?: CodexEmbed;
};

/** Codex's conversation column up to the current step. */
export function CodexThread({ steps, embed }: CodexThreadProps) {
  const working = steps.at(-1)?.working;

  return (
    <section className="codex-thread" aria-label="Codex">
      <div className="codex-scroll">
        <div className="codex-items">
          {steps.flatMap((step, s) =>
            step.codex.map((item, i) => (
              <CodexThreadItem
                key={`${s}-${i}`}
                item={item}
                embed={s === steps.length - 1 ? embed : undefined}
              />
            )),
          )}
          {working && <div className="codex-working">{working}</div>}
        </div>
      </div>
      <CodexComposer working={!!working} />
    </section>
  );
}
