import type { ReactNode } from "react";

import type { Task } from "../../../app/state/types";
import {
  LoadingSkeleton,
  SkeletonShape,
  SkeletonTextFrame,
} from "../../../shared/components/loading-skeleton/loading-skeleton";
import { hasRevision } from "../task-workspace";

const FACTS = [
  { label: "Task ID", labelSize: "small", valueKind: "short" },
  { label: "Created", labelSize: "small", valueKind: "long" },
  { label: "Latest activity", labelSize: "medium", valueKind: "long" },
  { label: "Description", labelSize: "short", valueKind: "description" },
  { label: "Worker", labelSize: "small", valueKind: "medium" },
  { label: "Permission mode", labelSize: "medium", valueKind: "medium" },
  { label: "Permission source", labelSize: "medium", valueKind: "medium" },
  {
    label: "Approval decision maker",
    labelSize: "long",
    valueKind: "medium",
  },
  { label: "Model", labelSize: "small", valueKind: "medium" },
  { label: "Reasoning effort", labelSize: "medium", valueKind: "medium" },
  { label: "Workspace", labelSize: "small", valueKind: "long" },
  { label: "Changes", labelSize: "small", valueKind: "changes" },
  { label: "Repository", labelSize: "small", valueKind: "long" },
  { label: "Workspace strategy", labelSize: "medium", valueKind: "medium" },
  { label: "Base commit", labelSize: "small", valueKind: "medium" },
  { label: "Session", labelSize: "small", valueKind: "medium" },
  { label: "Dependencies", labelSize: "small", valueKind: "medium" },
  { label: "Turns", labelSize: "small", valueKind: "short" },
  { label: "Runtime used", labelSize: "medium", valueKind: "short" },
  { label: "Estimated cost", labelSize: "medium", valueKind: "short" },
] as const;

type FactKind = (typeof FACTS)[number]["valueKind"];

type FactText = Record<string, string>;

const FACT_LAYOUT: Record<
  string,
  { labelSize: (typeof FACTS)[number]["labelSize"]; valueKind: FactKind }
> = Object.fromEntries(
  FACTS.map(({ label, labelSize, valueKind }) => [
    label,
    { labelSize, valueKind },
  ]),
);

function factLayout(label: string) {
  return (
    FACT_LAYOUT[label] ?? {
      labelSize: label.length > 20 ? "long" : "medium",
      valueKind: "medium" as const,
    }
  );
}

function factValue(kind: FactKind, text?: string): ReactNode {
  if (kind === "description") {
    return (
      <SkeletonTextFrame
        text={text ?? ""}
        className="task-details-skeleton-description-frame"
      >
        <span className="task-details-skeleton-description">
          <SkeletonShape className="task-details-skeleton-value task-details-skeleton-value-long" />
          <SkeletonShape className="task-details-skeleton-value task-details-skeleton-value-medium" />
        </span>
      </SkeletonTextFrame>
    );
  }

  if (kind === "changes") {
    return (
      <span className="task-details-changes-skeleton">
        <SkeletonShape className="task-details-changes-count" />
        <SkeletonShape className="task-details-changes-files" />
        <SkeletonShape className="task-details-changes-state" />
      </span>
    );
  }

  return (
    <SkeletonShape
      className={`task-details-skeleton-value task-details-skeleton-value-${kind}`}
      measureText={text}
    />
  );
}

type TaskDetailsSkeletonProps = {
  task?: Task;
  factTexts?: FactText;
};

/** Mirrors the Details metadata row and facts grid while task data is pending. */
export function TaskDetailsSkeleton({
  task,
  factTexts,
}: TaskDetailsSkeletonProps) {
  const facts = factTexts
    ? Object.entries(factTexts).map(([label, text]) => ({
        label,
        text,
        ...factLayout(label),
      }))
    : FACTS.map((fact) => ({ ...fact, text: undefined }));

  const projectText = task
      ? `${task.repository.split("/").at(-1) ?? ""} · ${hasRevision(task) ? `${task.revision} · ` : ""}${task.workspace_strategy === "current_repo" ? "project folder" : "isolated worktree"}`
      : "repository · revision · isolated worktree",
    runtimeText =
      task?.budget.max_runtime_minutes === null
        ? "No runtime limit"
        : `${task?.budget.max_runtime_minutes ?? 20} min limit`,
    costText =
      task?.budget.max_cost_usd === null
        ? "No cost limit"
        : `$${task?.budget.max_cost_usd ?? 10} budget`;

  return (
    <LoadingSkeleton
      label="Loading task details"
      className="task-details task-details-skeleton"
    >
      <div className="meta">
        <span className="task-details-meta-project">
          <SkeletonShape
            className="task-details-skeleton-meta-project"
            measureText={projectText}
          />
        </span>
        <span className="task-details-meta-runtime">
          <SkeletonShape
            className="task-details-skeleton-meta-limit"
            measureText={runtimeText}
          />
        </span>
        <span className="task-details-meta-cost">
          <SkeletonShape
            className="task-details-skeleton-meta-limit"
            measureText={costText}
          />
        </span>
      </div>
      <dl className="facts">
        {facts.map(({ label, labelSize, valueKind, text }) => (
          <div className="fact" key={label}>
            <dt>
              <SkeletonShape
                className={`task-details-skeleton-label task-details-skeleton-label-${labelSize}`}
                measureText={label}
              />
            </dt>
            <dd
              className={
                valueKind === "description" ? "task-fact-multiline" : undefined
              }
            >
              {factValue(valueKind, text)}
            </dd>
          </div>
        ))}
      </dl>
    </LoadingSkeleton>
  );
}
