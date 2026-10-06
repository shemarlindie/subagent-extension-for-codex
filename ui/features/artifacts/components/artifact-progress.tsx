import { Progress } from "@base-ui/react/progress";

type ArtifactProgressProps = {
  label: string;
  className?: string;
};

/** Shared indeterminate progress indicator for artifact rendering. */
export function ArtifactProgress({ label, className }: ArtifactProgressProps) {
  return (
    <Progress.Root
      value={null}
      className={["artifact-progress", className].filter(Boolean).join(" ")}
      aria-label={label}
    >
      <Progress.Track className="artifact-progress-track">
        <Progress.Indicator className="artifact-progress-indicator" />
      </Progress.Track>
    </Progress.Root>
  );
}
