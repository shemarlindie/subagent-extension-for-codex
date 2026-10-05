import { Collapsible } from "@base-ui/react/collapsible";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Button } from "./button";
import { Icon } from "./icons";
import { useAnimatedHeight } from "./motion";

/** Colors the notice's left bar; `warning` is the default and `plain` has no accent. */
export type NoticeTone = "warning" | "error" | "info" | "plain";

interface NoticeProps {
  tone?: NoticeTone;
  className?: string;
  children: ReactNode;
}

const noticeClass = (className?: string) =>
  className ? `notice ${className}` : "notice";

export function Notice({ tone = "warning", className, children }: NoticeProps) {
  return (
    <div className={noticeClass(className)} data-tone={tone}>
      {children}
    </div>
  );
}

interface CollapsibleNoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  /** One line under the title; it folds away once the notice is open. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

// The whole header row toggles the body, which stays mounted so collapsing keeps its state.
export function CollapsibleNotice({
  tone = "warning",
  title,
  summary,
  defaultOpen,
  onOpenChange,
  children,
}: CollapsibleNoticeProps) {
  return (
    <Collapsible.Root
      className={noticeClass("notice-collapsible")}
      data-tone={tone}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <Collapsible.Trigger className="notice-trigger">
        <span className="notice-heading">
          {title && <strong>{title}</strong>}
          {summary && (
            <span className="notice-summary">
              <span>{summary}</span>
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={12} className="notice-caret" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapse-panel" keepMounted>
        <div className="notice-body">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

interface ExpandableNoticeProps {
  tone?: NoticeTone;
  defaultOpen?: boolean;
  children: ReactNode;
}

// One text node that stays put: collapsed it clamps to its first line, open it grows in place.
// Text that fits on that line has nothing to expand to, so it is plain text without a toggle.
export function ExpandableNotice({
  tone = "plain",
  defaultOpen = false,
  children,
}: ExpandableNoticeProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  // A notice that starts open was opened for a reason, so it stays a toggle until measured closed.
  const [overflowing, setOverflowing] = useState(defaultOpen);
  useAnimatedHeight(ref, open);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || open) return;

    // Mid-animation the box is the interpolated height, not the clamp's, and swapping
    // the toggle for plain text then would remount the element and cut the animation.
    const measure = () => {
      if (element.getAnimations?.().length) return;
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [children, open, overflowing]);

  const text = (
    <span
      ref={ref}
      className="notice-expand-text"
      data-open={open || undefined}
    >
      {children}
    </span>
  );

  if (!overflowing && !open)
    return (
      <div className={noticeClass("notice-collapsible")} data-tone={tone}>
        <div className="notice-trigger notice-expandable notice-static">
          {text}
        </div>
      </div>
    );

  return (
    <div className={noticeClass("notice-collapsible")} data-tone={tone}>
      <button
        type="button"
        className="notice-trigger notice-expandable"
        aria-expanded={open}
        data-panel-open={open || undefined}
        onClick={() => setOpen(!open)}
      >
        {text}
        <Icon name="chevron-down" size={12} className="notice-caret" />
      </button>
    </div>
  );
}

// The expanded panel clamps notices so the fixed header leaves room for evidence.
export function NoticeText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useAnimatedHeight(ref, open);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [children, open]);

  return (
    <>
      <p ref={ref} className="notice-text" data-open={open || undefined}>
        {children}
      </p>
      {(overflowing || open) && (
        <Button
          variant="ghost"
          className="notice-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </>
  );
}
