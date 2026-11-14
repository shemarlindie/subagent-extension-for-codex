import { storyAt, type StoryMoment } from "./story";

/** The panel's story at a moment, failing the test before the panel appears. */
export function panelAt(moment: StoryMoment) {
  const panel = storyAt(moment);
  if (!panel) throw new Error(`The panel is not shown at step ${moment.step}`);

  return panel;
}
