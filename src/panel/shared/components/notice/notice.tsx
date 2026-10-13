import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Button } from "../button/button";
import { useAnimatedHeight } from "../motion/motion";

/** Colors the notice's left bar; `warning` is the default and `plain` has no accent. */
type NoticeTone = "warning" | "error" | "info" | "plain";

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
