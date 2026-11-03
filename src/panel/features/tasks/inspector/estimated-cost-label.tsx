import { Icon } from "../../../shared/components/icons/icons";
import { Infotip } from "../../../shared/components/infotip";
import { estimatedCostNote } from "../shared/estimated-cost";

export const ESTIMATED_COST_LABEL = "Estimated cost";

/** The cost fact's label, with a note that the figure isn't a bill. */
export function EstimatedCostLabel() {
  return (
    <span className="estimated-cost-label">
      {ESTIMATED_COST_LABEL}
      <Infotip
        label={estimatedCostNote("task")}
        triggerLabel="About estimated cost"
      >
        <button type="button" className="text-button estimated-cost-info">
          <Icon name="info" size={11} />
        </button>
      </Infotip>
    </span>
  );
}
