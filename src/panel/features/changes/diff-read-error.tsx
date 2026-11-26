import { Button } from "../../shared/components/button/button";

type DiffReadErrorProps = {
  error: string;
  onRetry: () => void;
};

/** Why a changed file's diff couldn't be read, with Retry. */
export function DiffReadError({ error, onRetry }: DiffReadErrorProps) {
  return (
    <div className="diff-file-note changed-file-diff-error">
      <p className="form-error" role="alert">
        {error}
      </p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}
