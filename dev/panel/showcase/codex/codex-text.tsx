import { Fragment } from "react";

type CodexTextProps = { text: string };

/** Plain text with `code` spans, which is all the story's Codex prose uses. */
export function CodexText({ text }: CodexTextProps) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, index) =>
      part.startsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
}
