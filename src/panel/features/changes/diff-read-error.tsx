import { Button } from "../../shared/components/button/button";

type DiffReadErrorProps = {
  error: string;
  /** Retry is reading the diff again. */
  retrying: boolean;
  onRetry: () => void;
};

/** Why a changed file's diff couldn't be read, with Retry. */
export function DiffReadError({
  error,
  retrying,
  onRetry,
}: DiffReadErrorProps) {
  return (
    <div className="diff-file-note changed-file-diff-error">
      <p className="form-error" role="alert">
        {error}
      </p>
      {/* Stays enabled so it keeps focus. A click while busy reads nothing new. */}
      <Button aria-busy={retrying || undefined} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
