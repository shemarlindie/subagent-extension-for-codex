import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";

type ViewedToggleProps = {
  path: string;
  viewed: boolean;
  onChange: (viewed: boolean) => void;
};

/**
 * Marks a changed file viewed. A button rather than an input, so it works
 * inside a file's header without opening or closing the file.
 */
export function ViewedToggle({ path, viewed, onChange }: ViewedToggleProps) {
  return (
    <Button
      role="checkbox"
      className="viewed-toggle"
      aria-checked={viewed}
      aria-label={`Viewed ${path}`}
      onClick={() => onChange(!viewed)}
    >
      <span className="viewed-box" aria-hidden="true">
        {/* Always there, so checking it can fade the mark in. */}
        <Icon name="check" size={10} strokeWidth={3} />
      </span>
      Viewed
    </Button>
  );
}
