// A Codex-like window with the real panel beside it, playing the curated
// story for screenshots. URL parameters choose the frame:
// ?step=N (0-based), ?theme=light|dark and ?capture to hide the controls.
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
import { story, storyAt } from "./story";
import { storyLaunch, storyTool } from "./story-tools";

type Theme = "light" | "dark";

type Frame = { step: number; theme: Theme; capture: boolean };

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
  };
}

function writeFrame({ step, theme, capture }: Frame) {
  const params = new URLSearchParams({ step: String(step), theme });
  if (capture) params.set("capture", "");
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
  const { step, theme, capture } = frame;
  // The frame's frozen clock, undefined until Codex delegates and the panel opens.
  const now = storyAt(step)?.now;
  const delegated = now !== undefined;

  const update = (patch: Partial<Frame>) =>
    setFrame((current) => ({ ...current, ...patch }));

  useEffect(() => {
    writeFrame(frame);
    document.documentElement.dataset.theme = theme;
  }, [frame, theme]);

  // Each step relaunches the panel, so a frame never depends on the last one.
  useEffect(() => {
    const iframe = panel.current;
    if (!iframe) return;

    const bridge = connectPanel(iframe, `./panel.html?now=${now}`, {
      name: "Showcase",
      capabilities,
      hostContext: hostContext(theme),
      callTool: async (name, args) => storyTool(step, name, args),
      launch: async () => storyLaunch(step),
    });

    return () => void bridge.close();
  }, [step, theme, now]);

  return (
    <div className="showcase">
      <main className={`window${delegated ? " split" : ""}`}>
        <CodexThread steps={story.slice(0, step + 1)} />
        {delegated && (
          <aside className="side-pane">
            <iframe
              ref={panel}
              key={`${step}-${theme}`}
              title="Codex Subagent Extension"
            />
          </aside>
        )}
      </main>
      {!capture && (
        <nav className="controls" aria-label="Showcase controls">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => update({ step: step - 1 })}
          >
            ‹
          </button>
          <span>
            {step + 1}/{story.length} · {story[step]!.label}
          </span>
          <button
            type="button"
            disabled={step === story.length - 1}
            onClick={() => update({ step: step + 1 })}
          >
            ›
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
