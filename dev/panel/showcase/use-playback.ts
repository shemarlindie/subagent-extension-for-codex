import { useEffect, useState } from "react";

import { PLAYBACK_MS, sceneAt } from "./playback";

const FRAME_MS = 100;

/** The playing loop and its scene, or none while paused. */
export function usePlayback(playing: boolean) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const started = performance.now();

    const timer = setInterval(
      () => setElapsed(performance.now() - started),
      FRAME_MS,
    );

    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [playing]);

  if (!playing) return undefined;

  return {
    loop: Math.floor(elapsed / PLAYBACK_MS),
    scene: sceneAt(elapsed % PLAYBACK_MS),
  };
}
