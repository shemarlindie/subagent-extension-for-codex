import type { ReactNode } from "react";

import { CodexIcon } from "./codex-icon";

/** An app Codex is opening inline, and whether it has loaded. */
export type CodexEmbed = { loaded: boolean; app: ReactNode };

type CodexAppItemProps = { name: string; embed?: CodexEmbed };

/**
 * An app Codex opened from a tool result. While opening, Codex shows it inline
 * in a card under its row. Expanded, only the row stays.
 */
export function CodexAppItem({ name, embed }: CodexAppItemProps) {
  const opening = embed && !embed.loaded;

  const row = (
    <div className="codex-row">
      <CodexIcon name="extension" />
      {opening ? `Opening ${name}` : `Opened ${name}`}
      {opening ? (
        <span className="codex-spinner" aria-hidden="true" />
      ) : (
        <CodexIcon name="expand" />
      )}
      {embed?.loaded && (
        <CodexIcon name="chevron" className="codex-embed-chevron" />
      )}
    </div>
  );

  if (!embed) return row;

  // The app loads behind its row, so the card opens on a ready panel.
  return (
    <div className={`codex-embed${embed.loaded ? " loaded" : ""}`}>
      {row}
      <div className="codex-embed-app">{embed.app}</div>
    </div>
  );
}
