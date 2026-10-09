import { Progress as BaseProgress } from "@base-ui/react/progress";

type ProgressProps = {
  label: string;
  className?: string;
};

/** Indeterminate progress indicator for loading and rendering files. */
export function Progress({ label, className }: ProgressProps) {
  return (
    <BaseProgress.Root
      value={null}
      className={["file-progress", className].filter(Boolean).join(" ")}
      aria-label={label}
    >
      <BaseProgress.Track className="file-progress-track">
        <BaseProgress.Indicator className="file-progress-indicator" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
