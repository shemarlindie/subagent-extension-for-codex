// Plays the story as one loop: Codex's items appear one at a time, the panel
// follows Codex's tool rows, and Claude's replies stream before Codex reads
// them.
import { story, type StoryMoment, type StoryStep } from "./story";

/** What a playing showcase shows at one time. */
export type Scene = {
  /** The step Codex is on, and how many of its items show. */
  step: number;
  items: number;
  /** The panel's moment, or none while its pane is closed. */
  panel?: StoryMoment;
};

type Cue = { duration: number; scene: (progress: number) => Scene };

const ITEM_MS = 800;
const STREAM_MS = 3500;
const HOLD_MS = 2200;
const FINAL_HOLD_MS = 6000;

function storyCues() {
  const cues: Cue[] = [];
  let panel: StoryMoment | undefined;

  const at = (duration: number, scene: Scene) =>
    cues.push({ duration, scene: () => scene });

  story.forEach((s, step) => {
    if (s.reply) {
      cues.push({
        duration: STREAM_MS,
        scene: (streamed) => ({ step, items: 0, panel: { step, streamed } }),
      });

      panel = { step };
    }

    // Codex's last tool row in a step is the call that changes Claude's task.
    const call = s.reply
      ? -1
      : s.codex.findLastIndex((item) => item.kind === "row");

    s.codex.forEach((_, i) => {
      at(ITEM_MS, { step, items: i + 1, panel });
      if (i === call && s.panel) panel = { step };
    });

    at(step === story.length - 1 ? FINAL_HOLD_MS : HOLD_MS, {
      step,
      items: s.codex.length,
      panel,
    });
  });

  return cues;
}

const cues = storyCues();

/** One loop's length. */
export const PLAYBACK_MS = cues.reduce((sum, cue) => sum + cue.duration, 0);

/** The scene at a time into the loop. */
export function sceneAt(elapsed: number): Scene {
  let start = 0;

  for (const cue of cues) {
    if (elapsed < start + cue.duration) {
      return cue.scene((elapsed - start) / cue.duration);
    }

    start += cue.duration;
  }

  return cues.at(-1)!.scene(1);
}

/** Codex's thread in a scene: earlier steps, and the step's items so far. */
export function threadAt({ step, items }: Scene): StoryStep[] {
  const current = {
    ...story[step]!,
    codex: story[step]!.codex.slice(0, items),
  };

  return items ? [...story.slice(0, step), current] : story.slice(0, step);
}
