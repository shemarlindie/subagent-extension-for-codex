import type { AutoAnimationPlugin } from "@formkit/auto-animate";

import { autoListEffects } from "../../../../src/panel/shared/components/motion/auto-list";

/** The window owns column resizing. Replaying its cached geometry on the next
 * message would move the thread a second time after the pane has opened. */
export const codexListEffects: AutoAnimationPlugin = (
  element,
  action,
  previous,
  next,
) => {
  if (
    action === "remain" &&
    previous &&
    next &&
    (previous.left !== next.left || previous.width !== next.width)
  ) {
    return new KeyframeEffect(element, [], { duration: 0 });
  }

  return autoListEffects(element, action, previous, next);
};
