import type { ReactNode } from "react";

import { MotionContent } from "../../../shared/components/motion/motion-content";
import { Presence } from "../../../shared/components/motion/presence";
import { formatCount } from "../../../shared/utils/format";

interface TabLabelProps {
  count: number;
  children: ReactNode;
}

/**
 * A tab label with its count as a superscript badge. The badge is positioned
 * outside the label's layout, so the count never changes the tab's width.
 */
export function TabLabel({ count, children }: TabLabelProps) {
  return (
    <span className="tab-label">
      {children}{" "}
      <span className="tab-badge">
        {/* The badge pops in when the first count arrives, rather than appearing at once. */}
        <Presence show={count > 0} as="span" variant="pop">
          <span className="tab-count">
            <MotionContent changeKey={count} variant="rise">
              {formatCount(count)}
            </MotionContent>
          </span>
        </Presence>
      </span>
    </span>
  );
}
