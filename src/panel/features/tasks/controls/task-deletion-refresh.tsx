import { Button } from "../../../shared/components/button/button";

type TaskDeletionRefreshProps = {
  checking: boolean;
  disabled: boolean;
  onRefresh: () => void;
};

export function TaskDeletionRefresh({
  checking,
  disabled,
  onRefresh,
}: TaskDeletionRefreshProps) {
  return (
    <Button
      type="button"
      variant="text"
      disabled={checking || disabled}
      onClick={onRefresh}
    >
      Refresh removal list
    </Button>
  );
}
