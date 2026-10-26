// Plays the story as one loop: Codex's items appear one at a time, the panel
// follows Codex's tool rows, and Claude's replies stream before Codex reads
// them. The panel first opens inline in Codex's thread, then expands into the
// side pane.
import { story, type StoryMoment, type StoryStep } from "./story";

/** What a playing showcase shows at one time. */
export type Scene = {
  /** The step Codex is on, and how many of its items show. */
  step: number;
  items: number;
  /** The panel's moment, or none before Codex opens it. */
  panel?: StoryMoment;
  /** Codex is opening the panel inline, and its side pane stays closed. */
  embed?: "loading" | "inline";
};

type Cue = { duration: number; scene: (progress: number) => Scene };

const ITEM_MS = 800;
const STREAM_MS = 3500;
const HOLD_MS = 2200;
const LOADING_MS = 1000;
const INLINE_MS = 2800;
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

    // Codex's last tool row or app in a step is the call that changes Claude's
    // task.
    const call = s.reply
      ? -1
      : s.codex.findLastIndex(
          (item) => item.kind === "row" || item.kind === "app",
        );

    s.codex.forEach((item, i) => {
      // An app opens inline on the step's task before its side pane opens.
      if (item.kind === "app" && s.panel) {
        panel = { step };
        at(LOADING_MS, { step, items: i + 1, panel, embed: "loading" });
        at(INLINE_MS, { step, items: i + 1, panel, embed: "inline" });
      }

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
