import { useEffect, useRef, useState } from "react";

import { Button } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import { MarkdownLink } from "../../../file-preview/markdown/markdown-link";
import { linkKind } from "../../../file-preview/markdown/markdown-urls";
import { useVisualTheme } from "./use-visual-theme";
import {
  frameMessage,
  MAX_VISUAL_HEIGHT,
  visualDocument,
} from "./visual-document";

/** Until the frame reports its content. */
const INITIAL_HEIGHT = 150;

type VisualFrameProps = { title: string; code: string };

/** One version of a visual, with the link it asked to open. */
type Revision = { code: string; srcDoc: string; link?: string };

const revision = (code: string, theme: string): Revision => ({
  code,
  srcDoc: visualDocument(code, theme),
});

/**
 * A worker's visual in a sandboxed frame. Scripts run on an opaque origin
 * with no network, and the frame can't reach the panel or navigate. It sizes
 * itself to its content. A link it asks to open shows below it as the panel's
 * own link, since the visual's scripts choose the destination.
 */
export function VisualFrame({ title, code }: VisualFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const theme = useVisualTheme();

  // A new version gets a new document, in the theme of the moment, and drops
  // the link the previous version asked to open.
  const [shown, setShown] = useState(() => revision(code, theme));
  if (shown.code !== code) setShown(revision(code, theme));
  const { srcDoc, link } = shown;

  // Theme changes restyle the document in place, keeping its state.
  useEffect(() => {
    ref.current?.contentWindow?.postMessage(
      { type: "visual-theme", css: theme },
      "*",
    );
  }, [theme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      // A sandboxed frame posts with origin "null", so check its window.
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const message = frameMessage(event.data);

      if (message?.type === "visual-height") {
        setHeight(Math.min(Math.max(message.height, 1), MAX_VISUAL_HEIGHT));
      }

      if (
        message?.type === "visual-link" &&
        linkKind(message.href) === "external"
      ) {
        const { href } = message;
        setShown((s) => ({ ...s, link: href }));
      }
    };

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <>
      <iframe
        ref={ref}
        className="visual-frame"
        title={title}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ height }}
      />
      {link && (
        <p className="visual-link form-note">
          <span>
            Open <MarkdownLink href={link}>{link}</MarkdownLink>
          </span>
          <Button
            variant="ghost"
            className="chat-icon-button"
            aria-label="Dismiss link"
            onClick={() => setShown((s) => ({ ...s, link: undefined }))}
          >
            <Icon name="close" size={8} />
          </Button>
        </p>
      )}
    </>
  );
}
