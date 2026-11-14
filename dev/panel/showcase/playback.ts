// Plays the story as one loop: Codex's items appear one at a time, the panel
// follows Codex's tool rows, and Claude's replies stream before Codex reads
// them. The panel first opens inline in Codex's thread, then expands into the
// side pane.
import { story, type StoryMoment, type StoryStep } from "./story";

/** What a playing showcase shows at one time. */
export type Scene = {
  /** Opening and closing fades bracket the story within its playback cues. */
  fade?: "in" | "out";
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
// The opening's blank delay comes out of the final hold, so the loop keeps its
// length. showcase.css delays the fade in by the same amount.
const OPENING_DELAY_MS = 400;
const OPENING_MS = OPENING_DELAY_MS + 1000;
const FINAL_HOLD_MS = 4000 - OPENING_DELAY_MS;
const CLOSING_MS = 800;

function storyCues() {
  const cues: [Cue, ...Cue[]] = [
    { duration: OPENING_MS, scene: () => ({ step: 0, items: 0, fade: "in" }) },
  ];

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

    const final = step === story.length - 1;

    const held: Scene = {
      step,
      items: s.codex.length,
      panel,
    };

    at(final ? FINAL_HOLD_MS - CLOSING_MS : HOLD_MS, held);
    if (final) at(CLOSING_MS, { ...held, fade: "out" });
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

  return (cues.at(-1) ?? cues[0]).scene(1);
}

/** Codex's thread in a scene: earlier steps, and the step's items so far. */
export function threadAt({ step, items }: Scene): StoryStep[] {
  const current = story[step];
  if (!current || !items) return story.slice(0, step);

  return [
    ...story.slice(0, step),
    { ...current, codex: current.codex.slice(0, items) },
  ];
}
