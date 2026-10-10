import type { BudgetRaise } from "../../../../../shared/tasks/model";
import { Notice } from "../../../../shared/components/notice/notice";
import { BudgetRaiseFields } from "../budget-raise-fields";
import { formatCost, type SpentBudget } from "../chat-model";

type BudgetLimitNoticeProps = {
  taskId: string;
  spent: SpentBudget;
  value: BudgetRaise;
  onChange: (value: BudgetRaise) => void;
  onApply: (value: BudgetRaise) => Promise<string | undefined>;
};

/** Shows the reached limits in the conversation, next to the failed turn. */
export function BudgetLimitNotice({
  taskId,
  spent,
  value,
  onChange,
  onApply,
}: BudgetLimitNoticeProps) {
  const fields: ("cost" | "runtime")[] = [];
  if (spent.cost) fields.push("cost");
  if (spent.runtime) fields.push("runtime");

  const title =
    spent.cost && spent.runtime
      ? "Budget limits reached"
      : spent.cost
        ? "Cost limit reached"
        : "Runtime limit reached";

  return (
    <Notice tone="warning" className="chat-budget-notice">
      <div
        data-chat-item={`budget-limit-${taskId}`}
        className="chat-budget-notice-content"
      >
        <div className="chat-budget-notice-header">
          <strong role="status">{title}</strong>
          {(spent.cost || spent.runtime) && (
            <span className="chat-budget-notice-header-detail">
              {spent.cost && (
                <>
                  {formatCost(spent.cost.used)} of{" "}
                  {formatCost(spent.cost.allowed)} used
                </>
              )}
              {spent.cost && spent.runtime && " · "}
              {spent.runtime && (
                <>
                  {Math.round(spent.runtime.usedMinutes)} of{" "}
                  {spent.runtime.allowedMinutes} mins used
                </>
              )}
            </span>
          )}
        </div>
        <div className="chat-budget-notice-detail">
          {spent.cost && spent.runtime
            ? "Apply higher cost and runtime limits to continue."
            : spent.cost
              ? "Apply a higher cost limit to continue."
              : spent.runtime
                ? "Apply a higher runtime limit to continue."
                : null}
        </div>
        {fields.length > 0 && (
          <BudgetRaiseFields
            key={taskId}
            fields={fields}
            spent={spent}
            value={value}
            onChange={onChange}
            onApply={onApply}
          />
        )}
      </div>
    </Notice>
  );
}
