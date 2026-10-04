import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { useAnimatedHeight } from "./motion";
import { Icon } from "./icons";
import { Button } from "./button";

/** Colors the notice's left bar; `warning` is the default. */
export type NoticeTone = "warning" | "error" | "info";

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
  title: ReactNode;
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
          <strong>{title}</strong>
          {summary && (
            <span className="notice-summary">
              <span>{summary}</span>
            </span>
          )}
        </span>
        <Icon name="chevron-down" square size={12} className="notice-caret" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapse-panel" keepMounted>
        <div className="notice-body">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
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
