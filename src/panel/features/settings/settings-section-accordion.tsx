import { Accordion } from "@base-ui/react/accordion";
import { type ReactNode, useEffect, useRef } from "react";

import { Chevron } from "../../shared/components/chevron";
import { reducedMotion } from "../../shared/components/motion/motion-utils";
import { openSections } from "./settings-layout";

export interface SettingsSectionView {
  id: string;
  title: string;
  summary: ReactNode;
  edits?: number;
  content: ReactNode;
}

function cssTimeToMilliseconds(value: string) {
  const time = Number.parseFloat(value);

  return value.trim().endsWith("ms") ? time : time * 1000;
}

function getTransitionDuration(element: Element) {
  const style = getComputedStyle(element),
    durations = style.transitionDuration.split(","),
    delays = style.transitionDelay.split(",");

  return Math.max(
    0,
    ...durations.map(
      (duration, index) =>
        cssTimeToMilliseconds(duration) +
        cssTimeToMilliseconds(delays[index % delays.length]),
    ),
  );
}

function scrollPanelIntoView(panel: HTMLElement, targetHeight: number) {
  const dialog = panel.closest<HTMLElement>("#dialog.dialog");

  if (!dialog) {
    panel.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion(panel) ? "instant" : "smooth",
    });

    return true;
  }

  const scrollContainer =
      panel.closest<HTMLElement>(".settings-form-body") ?? dialog,
    containerBounds = scrollContainer.getBoundingClientRect(),
    heading =
      scrollContainer === dialog
        ? dialog.querySelector<HTMLElement>(".dialog-heading")
        : undefined,
    footer =
      scrollContainer === dialog
        ? dialog.querySelector<HTMLElement>(".settings-form > footer")
        : undefined,
    panelBounds = panel.getBoundingClientRect(),
    trigger = panel
      .closest<HTMLElement>(".settings-group")
      ?.querySelector<HTMLElement>(".settings-group-trigger"),
    triggerBounds = trigger?.getBoundingClientRect(),
    visibleTop = Math.max(
      containerBounds.top,
      heading?.getBoundingClientRect().bottom ?? containerBounds.top,
    ),
    visibleBottom = Math.min(
      containerBounds.bottom,
      footer?.getBoundingClientRect().top ?? containerBounds.bottom,
    ),
    availableHeight = Math.max(0, visibleBottom - visibleTop),
    sectionHeight = targetHeight + (triggerBounds?.height ?? 0),
    panelBottom = panelBounds.top + targetHeight;

  let scrollBy = 0;

  if (sectionHeight > availableHeight) {
    scrollBy = (triggerBounds?.top ?? panelBounds.top) - visibleTop;
  } else if (panelBottom > visibleBottom) {
    scrollBy = panelBottom - visibleBottom;
  } else if (panelBounds.top < visibleTop) {
    scrollBy = panelBounds.top - visibleTop;
  }

  if (!scrollBy) return true;

  const targetScrollTop = scrollContainer.scrollTop + scrollBy,
    maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;

  // The target range grows during the panel transition. Avoid a partial smooth
  // scroll that the browser clamps to the old range; the completion pass will
  // retry after the newly opened content contributes its full height.
  if (targetScrollTop < 0 || targetScrollTop > maxScrollTop + 1) return false;

  scrollContainer.scrollBy({
    top: scrollBy,
    behavior: reducedMotion(scrollContainer) ? "instant" : "smooth",
  });

  return true;
}

interface SettingsSectionAccordionProps {
  sections: SettingsSectionView[];
  open: string[];
  loading: boolean;
  onOpenChange: (next: string[]) => void;
}

/** Shared section headers and panels for loading placeholders and real rows. */
export function SettingsSectionAccordion({
  sections,
  open,
  loading,
  onOpenChange,
}: SettingsSectionAccordionProps) {
  const previousOpen = useRef(open);

  useEffect(() => {
    const newlyOpened = open.find(
      (section) => !previousOpen.current.includes(section),
    );

    previousOpen.current = open;
    if (!newlyOpened) return;

    const panel = document.getElementById(
      `settings-section-panel-${newlyOpened}`,
    );

    if (!panel) return;

    let cancelled = false,
      waiting = false,
      correctionFrame: number | undefined,
      correctionTimer: number | undefined;

    const correctAfterExpansion = () => {
      if (cancelled || correctionFrame !== undefined) return;

      if (correctionTimer !== undefined) window.clearTimeout(correctionTimer);

      correctionFrame = requestAnimationFrame(() => {
        correctionFrame = undefined;
        if (!cancelled)
          scrollPanelIntoView(panel, panel.getBoundingClientRect().height);
      });
    };

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "height")
        correctAfterExpansion();
    };

    panel.addEventListener("transitionend", handleTransitionEnd);

    const scrollDuringExpansion = () => {
      if (cancelled || waiting || panel.hasAttribute("data-starting-style"))
        return;

      waiting = true;
      panel.getBoundingClientRect();

      const measuredHeight = Number.parseFloat(
        panel.style.getPropertyValue("--accordion-panel-height"),
      );

      const targetHeight = Number.isFinite(measuredHeight)
        ? measuredHeight
        : Math.max(panel.scrollHeight, panel.getBoundingClientRect().height);

      // Start scrolling with the height transition instead of after it settles.
      scrollPanelIntoView(panel, targetHeight);

      // A scroll near the container's end can be clamped before the panel has
      // grown enough to extend the scroll range. Recheck once the height settles.
      correctionTimer = window.setTimeout(
        correctAfterExpansion,
        getTransitionDuration(panel) + 50,
      );
    };

    if (typeof MutationObserver === "undefined") {
      const waitForStartingStyle = () => {
        if (cancelled) return;
        if (panel.hasAttribute("data-starting-style"))
          requestAnimationFrame(waitForStartingStyle);
        else scrollDuringExpansion();
      };

      waitForStartingStyle();

      return () => {
        cancelled = true;
        panel.removeEventListener("transitionend", handleTransitionEnd);
        if (correctionTimer !== undefined) window.clearTimeout(correctionTimer);
        if (correctionFrame !== undefined)
          cancelAnimationFrame(correctionFrame);
      };
    }

    const observer = new MutationObserver(scrollDuringExpansion);

    observer.observe(panel, {
      attributes: true,
      attributeFilter: ["data-starting-style"],
    });

    scrollDuringExpansion();

    return () => {
      cancelled = true;
      observer.disconnect();
      panel.removeEventListener("transitionend", handleTransitionEnd);
      if (correctionTimer !== undefined) window.clearTimeout(correctionTimer);
      if (correctionFrame !== undefined) cancelAnimationFrame(correctionFrame);
    };
  }, [open]);

  return (
    <Accordion.Root
      className={`settings-groups${loading ? " settings-loading-groups" : ""}`}
      multiple
      keepMounted
      value={openSections(open, sections)}
      onValueChange={(value) => onOpenChange(value as string[])}
      aria-busy={loading || undefined}
    >
      {sections.map((section) => (
        <Accordion.Item
          key={section.id}
          value={section.id}
          className="settings-group"
        >
          <Accordion.Header className="settings-group-header">
            <Accordion.Trigger className="settings-group-trigger">
              <Chevron />
              <span className="settings-group-title">{section.title}</span>
              <span
                className={`settings-group-summary${loading ? "" : " motion-swap"}`}
              >
                {section.summary}
              </span>
              {section.edits ? (
                <span className="settings-group-badge">
                  {section.edits} changed
                </span>
              ) : null}
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel
            id={`settings-section-panel-${section.id}`}
            className="collapse-panel settings-group-panel"
          >
            <div
              className={`settings-group-content${loading ? "" : " motion-swap"}`}
            >
              {section.content}
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
