import { type ComponentProps, type MouseEvent, useContext } from "react";

import { ControllerContext } from "../../../app/state/controller-context";
import { linkKind } from "./markdown-urls";

type MarkdownLinkProps = ComponentProps<"a"> & { node?: unknown };

/** The id a fragment names, decoded when it is valid percent-encoding. */
function fragmentId(href: string) {
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

/**
 * Scrolls to the footnote or heading a fragment names inside the same rendered
 * Markdown. Nothing happens when no element has that id.
 */
function jumpWithin(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();

  const id = fragmentId(href),
    root = event.currentTarget.closest<HTMLElement>(".markdown-body"),
    prefix = root?.dataset.idPrefix ?? "";

  // Footnote links already carry the view's prefix; heading links are written
  // as plain slugs, sometimes with the heading's own capitals.
  const ids = new Set([id, prefix + id, prefix + id.toLowerCase()]);

  const target = [...(root?.querySelectorAll<HTMLElement>("[id]") ?? [])].find(
    (element) => ids.has(element.id),
  );

  target?.scrollIntoView({ block: "nearest" });
}

export function MarkdownLink({
  node: _node,
  href,
  children,
  ...rest
}: MarkdownLinkProps) {
  const controller = useContext(ControllerContext),
    kind = linkKind(href);

  if (kind === "text")
    return (
      <span className="markdown-link-text" title={href || undefined}>
        {children}
      </span>
    );

  if (kind === "fragment")
    return (
      <a {...rest} href={href} onClick={(event) => jumpWithin(event, href!)}>
        {children}
      </a>
    );

  const openLink = controller?.transport.openLink?.bind(controller.transport);

  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={
        openLink &&
        ((event) => {
          // Embedded hosts sandbox the panel, so the host opens the link.
          event.preventDefault();
          controller!.run(() => openLink(href!));
        })
      }
    >
      {children}
    </a>
  );
}
