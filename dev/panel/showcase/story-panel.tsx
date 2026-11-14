import type {
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { useEffect, useRef, useState } from "react";

import darkStyles from "../host/host-styles-dark.json";
import lightStyles from "../host/host-styles-light.json";
import { connectPanel } from "../host/panel-bridge";
import { storyClock } from "./story";
import type { StoryFeed } from "./story-feed";

export type Theme = "light" | "dark";

/** Inline in Codex's thread, or fullscreen in its side pane. */
type PanelMode = "inline" | "fullscreen";

type StoryPanelProps = {
  feed: StoryFeed;
  theme: Theme;
  mode: PanelMode;
  /** Lets the panel's clock run on between the times `now` sets. */
  tick: boolean;
  now: number;
};

type ShowcaseWindow = Window & { setShowcaseNow?: (now: number) => void };

const capabilities: McpUiHostCapabilities = {
  serverTools: {},
  openLinks: {},
  logging: {},
  message: { text: {} },
  updateModelContext: { structuredContent: {} },
};

function hostContext(theme: Theme, mode: PanelMode) {
  const styles = theme === "dark" ? darkStyles : lightStyles;

  return {
    theme,
    displayMode: mode,
    availableDisplayModes: ["inline", "fullscreen"],
    platform: "desktop",
    locale: "en-US",
    timeZone: "UTC",
    styles: styles.styles,
  } satisfies McpUiHostContext;
}

/**
 * The real panel on the story, launched once per mount. Key it to relaunch,
 * since its feed, theme and mode are fixed at launch.
 */
export function StoryPanel({ feed, theme, mode, tick, now }: StoryPanelProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    const start = storyClock(feed.current());

    const bridge = connectPanel(
      iframe,
      `./panel.html?now=${start}${tick ? "&tick" : ""}`,
      {
        name: "Showcase",
        capabilities,
        hostContext: hostContext(theme, mode),
        callTool: (name, args) => feed.call(name, args),
        launch: async () => feed.launch(),
        onHeight: setHeight,
      },
    );

    return () => void bridge.close();
  }, [feed, theme, mode, tick]);

  // A playing panel's clock jumps to each new event, then runs on.
  useEffect(() => {
    (frame.current?.contentWindow as ShowcaseWindow | null)?.setShowcaseNow?.(
      now,
    );
  }, [now]);

  return (
    <iframe
      ref={frame}
      title="Subagent Extension for Codex"
      style={mode === "inline" ? { height } : undefined}
    />
  );
}
