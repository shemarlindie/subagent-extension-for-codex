import "./codex.css";

import { useAutoAnimate } from "@formkit/auto-animate/react";

import { story, type StoryStep } from "../story";
import type { CodexEmbed } from "./codex-app-item";
import { CodexComposer } from "./codex-composer";
import { codexListEffects } from "./codex-list-motion";
import { CodexThreadItem } from "./codex-thread-item";

type CodexThreadProps = {
  steps: StoryStep[];
  opening?: boolean;
  /** The app the latest step is opening inline. */
  embed?: CodexEmbed;
};

/** Codex's conversation column up to the current step. */
export function CodexThread({ steps, embed, opening }: CodexThreadProps) {
  const working = steps.at(-1)?.working;
  const firstPrompt = story[0]?.codex.find((item) => item.kind === "user");
  const [itemsRef] = useAutoAnimate<HTMLDivElement>(codexListEffects);

  return (
    <section className="codex-thread" aria-label="Codex">
      <div className="codex-scroll">
        <div className="codex-items" ref={itemsRef}>
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
      <CodexComposer
        working={!!working}
        draft={opening ? firstPrompt?.text : undefined}
      />
    </section>
  );
}
