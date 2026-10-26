// A Codex-like window with the real panel beside it, playing the curated
// story for screenshots. URL parameters choose the frame:
// ?step=N (0-based), ?theme=light|dark and ?capture to hide the controls.
// ?play loops the whole story instead, with the panel open throughout.
import "./showcase.css";

import type {
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { useEffect, useRef, useState } from "react";

import darkStyles from "../host/host-styles-dark.json";
import lightStyles from "../host/host-styles-light.json";
import { connectPanel } from "../host/panel-bridge";
import { CodexThread } from "./codex/codex-thread";
import { threadAt } from "./playback";
import { story, storyAt, type StoryMoment } from "./story";
import { StoryFeed } from "./story-feed";
import { usePlayback } from "./use-playback";

type Theme = "light" | "dark";

type Frame = { step: number; theme: Theme; capture: boolean; play: boolean };

/** The panel loads behind its closed pane with the task Codex opens it on. */
const preload: StoryMoment = { step: story.findIndex((s) => s.panel) };

type ShowcaseWindow = Window & { setShowcaseNow?: (now: number) => void };

const capabilities: McpUiHostCapabilities = {
  serverTools: {},
  openLinks: {},
  logging: {},
  message: { text: {} },
  updateModelContext: { structuredContent: {} },
};

function readFrame(): Frame {
  const params = new URLSearchParams(location.search);
  const step = Number(params.get("step") ?? story.length - 2);

  return {
    step: Math.min(
      Math.max(0, Number.isFinite(step) ? step : 0),
      story.length - 1,
    ),
    theme: params.get("theme") === "light" ? "light" : "dark",
    capture: params.has("capture"),
    play: params.has("play"),
  };
}

function writeFrame({ step, theme, capture, play }: Frame) {
  const params = new URLSearchParams({ step: String(step), theme });
  if (capture) params.set("capture", "");
  if (play) params.set("play", "");
  history.replaceState(null, "", `?${params}`);
}

function hostContext(theme: Theme): McpUiHostContext {
  const styles = theme === "dark" ? darkStyles : lightStyles;

  return {
    theme,
    displayMode: "fullscreen",
    availableDisplayModes: ["inline", "fullscreen"],
    platform: "desktop",
    locale: "en-US",
    timeZone: "UTC",
    styles: styles.styles,
  };
}

// The only export, so Fast Refresh can swap it in place. main.tsx mounts it.
export function Showcase() {
  const [frame, setFrame] = useState(readFrame);
  const panel = useRef<HTMLIFrameElement>(null);
  const { step, theme, capture, play } = frame;
  const playback = usePlayback(play);
  const scene = playback?.scene;
  // What the panel shows, and whether its pane is open.
  const shown = scene ? scene.panel : storyAt({ step }) && { step };
  const moment = shown ?? preload;
  const [feed] = useState(() => new StoryFeed(moment));
  // The panel's clock, a few seconds after the latest event it shows.
  const now = storyAt(moment)!.now;
  // Stills relaunch the panel each step, so a frame never depends on the last
  // one. Playback keeps it open, relaunching only as the story starts over.
  const launch = playback ? `loop-${playback.loop}` : `step-${step}`;

  const update = (patch: Partial<Frame>) =>
    setFrame((current) => ({ ...current, ...patch }));

  useEffect(() => {
    writeFrame(frame);
    document.documentElement.dataset.theme = theme;
  }, [frame, theme]);

  useEffect(() => feed.set(moment), [feed, moment]);

  useEffect(() => {
    const iframe = panel.current;
    if (!iframe) return;
    const start = storyAt(feed.current())!.now;

    const bridge = connectPanel(
      iframe,
      `./panel.html?now=${start}${play ? "&tick" : ""}`,
      {
        name: "Showcase",
        capabilities,
        hostContext: hostContext(theme),
        callTool: (name, args) => feed.call(name, args),
        launch: async () => feed.launch(),
      },
    );

    return () => void bridge.close();
  }, [feed, launch, theme, play]);

  // A playing panel's clock jumps to each new event, then runs on.
  useEffect(() => {
    (panel.current?.contentWindow as ShowcaseWindow | null)?.setShowcaseNow?.(
      now,
    );
  }, [now]);

  return (
    <div className="showcase">
      <main className={`window${shown ? " split" : ""}`}>
        <CodexThread
          steps={scene ? threadAt(scene) : story.slice(0, step + 1)}
        />
        <aside className="side-pane">
          <iframe
            ref={panel}
            key={`${launch}-${theme}`}
            title="Codex Subagent Extension"
          />
        </aside>
      </main>
      {!capture && (
        <nav className="controls" aria-label="Showcase controls">
          <button
            type="button"
            disabled={play || step === 0}
            onClick={() => update({ step: step - 1 })}
          >
            ‹
          </button>
          <span>
            {play
              ? "Playing"
              : `${step + 1}/${story.length} · ${story[step]!.label}`}
          </span>
          <button
            type="button"
            disabled={play || step === story.length - 1}
            onClick={() => update({ step: step + 1 })}
          >
            ›
          </button>
          <button type="button" onClick={() => update({ play: !play })}>
            {play ? "Stop" : "Play"}
          </button>
          <button
            type="button"
            onClick={() =>
              update({ theme: theme === "dark" ? "light" : "dark" })
            }
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </nav>
      )}
    </div>
  );
}
