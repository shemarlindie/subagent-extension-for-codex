import { Button } from "../button/button";
import { Icon } from "../icons/icons";
import { TooltipWrapper } from "../tooltip";

type StepNavProps = {
  /** Names the navigation landmark, such as "Changed files". */
  label: string;
  /** Names one item in the step buttons' tooltips, such as "file". */
  noun: string;
  index: number;
  count: number;
  onStep: (index: number) => void;
};

/**
 * The item's position with previous and next buttons that wrap at either end.
 * Its controls keep their places as items switch.
 */
export function StepNav({ label, noun, index, count, onStep }: StepNavProps) {
  return (
    <nav className="step-nav" aria-label={label}>
      {/* Focus stays on the step buttons, so announce where they led. */}
      <span className="step-nav-position" aria-live="polite">
        {index + 1} / {count}
      </span>
      {/* A lone item has nowhere to step to. */}
      {count > 1 && (
        <>
          <TooltipWrapper label={`Previous ${noun}`}>
            <Button
              variant="ghost"
              className="toolbar-icon-button step-nav-step"
              data-direction="previous"
              onClick={() => onStep((index - 1 + count) % count)}
            >
              <Icon name="chevron-down" size={14} />
            </Button>
          </TooltipWrapper>
          <TooltipWrapper label={`Next ${noun}`}>
            <Button
              variant="ghost"
              className="toolbar-icon-button step-nav-step"
              data-direction="next"
              onClick={() => onStep((index + 1) % count)}
            >
              <Icon name="chevron-down" size={14} />
            </Button>
          </TooltipWrapper>
        </>
      )}
    </nav>
  );
}
