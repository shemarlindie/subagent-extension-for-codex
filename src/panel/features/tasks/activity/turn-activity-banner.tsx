import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";

type TurnActivityBannerProps = {
  turn: number;
  loading: boolean;
  onShowLatest: () => void;
};

/** Says Activity shows one turn's events, with the way back to the latest. */
export function TurnActivityBanner({
  turn,
  loading,
  onShowLatest,
}: TurnActivityBannerProps) {
  return (
    <div className="activity-turn-banner">
      <span className="activity-turn-banner-label" role="status">
        <Icon name="clock" size={13} className="activity-turn-banner-icon" />
        <span>
          {loading ? "Loading activity for " : "Showing activity for "}
          <strong>turn {turn}</strong>
          {loading && "…"}
        </span>
      </span>
      <Button variant="text" underline onClick={onShowLatest}>
        Show latest activity
      </Button>
    </div>
  );
}
