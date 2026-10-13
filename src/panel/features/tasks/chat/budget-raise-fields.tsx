import { Switch } from "@base-ui/react/switch";
import { useState } from "react";

import type { BudgetRaise } from "../../../../shared/tasks/model";
import { useSnapshot } from "../../../app/state/controller-context";
import { Button } from "../../../shared/components/button/button";
import { FormFieldError } from "../../../shared/forms/form-field-error";
import { formatCost, type SpentBudget } from "./chat-model";

type BudgetField = "cost" | "runtime";

type BudgetRaiseFieldsProps = {
  fields: readonly BudgetField[];
  spent: SpentBudget;
  value: BudgetRaise;
  onChange: (value: BudgetRaise) => void;
  onApply: (value: BudgetRaise) => Promise<string | undefined>;
};

/** The spent budget amounts, with controls to raise them for the next message. */
export function BudgetRaiseFields({
  fields,
  spent,
  value,
  onChange,
  onApply,
}: BudgetRaiseFieldsProps) {
  return (
    <div
      className="chat-budget-raise"
      role="group"
      aria-label="Raise budget limits"
    >
      <div className="chat-budget-fields">
        {fields.map((field) => (
          <BudgetRaiseField
            key={field}
            field={field}
            spent={spent}
            value={value}
            onChange={onChange}
            onApply={onApply}
          />
        ))}
      </div>
    </div>
  );
}

function BudgetRaiseField({
  field,
  spent,
  value,
  onChange,
  onApply,
}: Omit<BudgetRaiseFieldsProps, "fields"> & { field: BudgetField }) {
  const busy = useSnapshot().busy;
  const [applyError, setApplyError] = useState<string>();
  const isCost = field === "cost";
  const spentAmount = isCost ? spent.cost : spent.runtime;
  const current = isCost ? spent.cost?.allowed : spent.runtime?.allowedMinutes;
  const candidate = isCost ? value.max_cost_usd : value.max_runtime_minutes;

  const enabled = isCost
    ? value.max_cost_usd !== null
    : value.max_runtime_minutes !== null;

  const currentLimitText = current === undefined ? "" : String(current);

  const limitTextFallback =
    typeof candidate === "number" ? String(candidate) : currentLimitText;

  const [costLimit, setCostLimit] = useState(limitTextFallback);
  const [runtimeLimit, setRuntimeLimit] = useState(limitTextFallback);
  const limitText = isCost ? costLimit : runtimeLimit;

  const candidateBelowCurrent =
    typeof candidate === "number" &&
    current !== undefined &&
    candidate < current;

  const validationHelp = candidateBelowCurrent
    ? `Enter a limit higher than ${isCost ? formatCost(current) : `${current} mins`}.`
    : undefined;

  const activeError = applyError ?? validationHelp;

  const canApply =
    current !== undefined &&
    candidate !== undefined &&
    candidate !== current &&
    (candidate === null || (Number.isFinite(candidate) && candidate > current));

  const updateLimit = (amount: string) => {
    const parsedAmount =
      amount && Number.isFinite(Number(amount)) ? Number(amount) : undefined;

    setApplyError(undefined);

    if (isCost) {
      setCostLimit(amount);
      onChange({ ...value, max_cost_usd: parsedAmount });
    } else {
      setRuntimeLimit(amount);
      onChange({ ...value, max_runtime_minutes: parsedAmount });
    }
  };

  const updateEnabled = (checked: boolean) => {
    setApplyError(undefined);
    const parsedAmount = Number(limitText);

    const fallbackAmount = checked ? current : null;

    const nextAmount =
      checked && Number.isFinite(parsedAmount) && parsedAmount > 0
        ? parsedAmount
        : fallbackAmount;

    if (isCost) onChange({ ...value, max_cost_usd: nextAmount });
    else onChange({ ...value, max_runtime_minutes: nextAmount });
  };

  const apply = async () => {
    if (!canApply || candidate === undefined) return;

    const raise: BudgetRaise = isCost
      ? { max_cost_usd: candidate }
      : { max_runtime_minutes: candidate };

    const error = await onApply(raise);

    if (error) {
      setApplyError(error);

      return;
    }

    setApplyError(undefined);
    const next = { ...value };
    if (isCost) delete next.max_cost_usd;
    else delete next.max_runtime_minutes;
    onChange(next);
  };

  if (!spentAmount) return null;

  const limitLabel = isCost ? "Cost limit" : "Runtime limit (minutes)";

  return (
    <div
      className="chat-budget-field"
      role="group"
      aria-label={`Raise ${field} limit`}
    >
      <div className="chat-budget-controls">
        <div
          className="chat-budget-limit-input"
          data-disabled={enabled ? undefined : ""}
          data-invalid={candidateBelowCurrent ? "" : undefined}
        >
          <span aria-hidden="true" data-suffix={isCost ? undefined : ""}>
            {isCost ? "$" : "min"}
          </span>
          <input
            type="number"
            min={current}
            step="any"
            aria-label={limitLabel}
            aria-invalid={candidateBelowCurrent || undefined}
            aria-describedby={
              validationHelp ? `chat-budget-${field}-help` : undefined
            }
            placeholder="New limit"
            disabled={!enabled || busy}
            value={limitText}
            onChange={(event) => updateLimit(event.target.value)}
          />
        </div>
        <span className="chat-budget-switch-control">
          <Switch.Root
            className="switch"
            aria-label={isCost ? "Cost limit" : "Runtime limit"}
            checked={enabled}
            disabled={busy}
            onCheckedChange={updateEnabled}
          >
            <Switch.Thumb className="switch-thumb" />
          </Switch.Root>
          <span>{enabled ? "Enabled" : "Disabled"}</span>
        </span>
        <Button
          variant="primary"
          className="chat-budget-apply"
          disabled={!canApply || busy}
          onClick={() => void apply()}
        >
          Apply
        </Button>
      </div>
      <FormFieldError
        className="chat-budget-help chat-budget-error"
        id={validationHelp ? `chat-budget-${field}-help` : undefined}
        message={activeError}
      />
    </div>
  );
}
