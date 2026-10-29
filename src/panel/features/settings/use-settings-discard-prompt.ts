import { type RefObject, useEffect } from "react";

import { reducedMotion } from "../../shared/components/motion/motion-utils";

/** Reveal the discard prompt after its expansion settles. */
export function useSettingsDiscardPrompt(
  showDiscard: boolean,
  discardPrompt: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!showDiscard) return;
    const prompt = discardPrompt.current;
    if (!prompt) return;
    let cancelled = false;

    const reveal = () => {
      if (cancelled) return;

      prompt
        .querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });

      prompt.scrollIntoView({
        block: "start",
        behavior: reducedMotion(prompt) ? "instant" : "smooth",
      });
    };

    if (typeof prompt.getAnimations !== "function") {
      reveal();

      return;
    }

    // Wait until Base UI removes its starting styles, then wait for the
    // resulting height transition. Scrolling uses the final expanded bounds.
    let waiting = false;

    const finishExpansion = async () => {
      if (waiting || prompt.hasAttribute("data-starting-style")) return;
      waiting = true;
      prompt.getBoundingClientRect();

      await Promise.allSettled(
        prompt.getAnimations().map((animation) => animation.finished),
      );

      reveal();
    };

    const observer = new MutationObserver(() => void finishExpansion());

    observer.observe(prompt, {
      attributes: true,
      attributeFilter: ["data-starting-style"],
    });

    void finishExpansion();

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [discardPrompt, showDiscard]);
}
