import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { ControllerContext } from "../../../../app/state/controller-context";
import { linkKind } from "../../../file-preview/markdown/markdown-urls";
import { useVisualTheme } from "./use-visual-theme";
import {
  frameMessage,
  MAX_VISUAL_HEIGHT,
  visualDocument,
} from "./visual-document";

/** Until the frame reports its content. */
const INITIAL_HEIGHT = 150;

/** A click in a frame activates the panel too, so a script alone can't. */
const clicked = () =>
  "userActivation" in navigator && navigator.userActivation.isActive;

type VisualFrameProps = { title: string; code: string };

/**
 * A worker's visual in a sandboxed frame. Scripts run on an opaque origin
 * with no network, and the frame can't reach the panel or navigate. It sizes
 * itself to its content and opens links through the panel, after a click.
 */
export function VisualFrame({ title, code }: VisualFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const controller = useContext(ControllerContext);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const theme = useVisualTheme();
  const srcDoc = useMemo(() => visualDocument(code, theme), [code, theme]);

  useEffect(() => {
    // Embedded hosts sandbox the panel, so the host opens the link.
    const openLink = controller?.transport.openLink?.bind(controller.transport);

    const onMessage = (event: MessageEvent<unknown>) => {
      // A sandboxed frame posts with origin "null", so check its window.
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const message = frameMessage(event.data);

      if (message?.type === "visual-height") {
        setHeight(Math.min(Math.max(message.height, 1), MAX_VISUAL_HEIGHT));
      }

      if (
        message?.type === "visual-link" &&
        linkKind(message.href) === "external" &&
        clicked()
      ) {
        const { href } = message;

        if (controller && openLink) {
          controller.run(() => openLink(href));
        } else {
          window.open(href, "_blank", "noopener,noreferrer");
        }
      }
    };

    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);
  }, [controller]);

  return (
    <iframe
      ref={ref}
      className="visual-frame"
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}
