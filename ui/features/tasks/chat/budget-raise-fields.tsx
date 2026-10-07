import type { BudgetRaise } from "../../../../src/shared/contracts";
import { formatCost, type SpentBudget } from "./chat-model";

type BudgetRaiseFieldsProps = {
  spent: SpentBudget;
  value: BudgetRaise;
  onChange: (value: BudgetRaise) => void;
};

/** A spent budget's amounts, with fields that raise it for the next message. */
export function BudgetRaiseFields({
  spent,
  value,
  onChange,
}: BudgetRaiseFieldsProps) {
  return (
    <div className="chat-budget" role="group" aria-label="Raise the budget">
      <p>
        {spent.cost && (
          <>
            Used {formatCost(spent.cost.used)} of{" "}
            {formatCost(spent.cost.allowed)}.{" "}
          </>
        )}
        {spent.runtime && (
          <>
            Ran {Math.round(spent.runtime.usedMinutes)} of{" "}
            {spent.runtime.allowedMinutes} minutes.{" "}
          </>
        )}
        Raise the budget to continue.
      </p>
      <div className="chat-budget-fields">
        {spent.cost && (
          <label>
            Cost limit ($)
            <input
              type="number"
              min={spent.cost.allowed}
              max={100}
              step="any"
              value={value.max_cost_usd ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  max_cost_usd: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
        )}
        {spent.runtime && (
          <label>
            Runtime limit (minutes)
            <input
              type="number"
              min={spent.runtime.allowedMinutes}
              max={120}
              step="any"
              value={value.max_runtime_minutes ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  max_runtime_minutes: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
        )}
      </div>
    </div>
  );
}
