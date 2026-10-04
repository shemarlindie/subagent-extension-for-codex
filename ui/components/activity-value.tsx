import type { ReactNode } from "react";
import { label, MAX_ACTIVITY_DEPTH, record } from "../utils/activity";
import { NestedContentOmitted } from "./nested-content-omitted";

const fieldLabels: Record<string, string> = {
  pre_tokens: "Tokens before compaction",
  post_tokens: "Tokens after compaction",
  total_cost_usd: "Total cost",
  cost_usd: "Cost",
  duration_ms: "Duration",
  duration_api_ms: "API duration",
  retry_delay_ms: "Retry delay",
  elapsed_time_seconds: "Elapsed time",
  resetsAt: "Resets at",
  overageResetsAt: "Overage resets at",
  num_turns: "Turns",
  max_retries: "Maximum retries",
  file_path: "File path",
};

interface FieldValueProps {
  name: string;
  value: unknown;
  depth: number;
}

function FieldValue({ name, value, depth }: FieldValueProps): ReactNode {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (name.endsWith("_usd"))
      return (
        <span>
          {new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 4,
          }).format(value)}
        </span>
      );
    if (name.endsWith("_ms"))
      return <span>{(value / 1000).toLocaleString()} s</span>;
    if (name === "elapsed_time_seconds")
      return <span>{value.toLocaleString()} s</span>;
    if (name === "utilization")
      return <span>{(value * 100).toLocaleString()}%</span>;
    if (name === "resetsAt" || name === "overageResetsAt")
      return <span>{new Date(value * 1000).toLocaleString()}</span>;
    if (name.includes("tokens")) return <span>{value.toLocaleString()}</span>;
  }

  if (
    typeof value === "string" &&
    [
      "command",
      "old_string",
      "new_string",
      "diff",
      "stdout",
      "stderr",
    ].includes(name)
  )
    return <pre>{value}</pre>;
  if (
    typeof value === "string" &&
    [
      "status",
      "state",
      "outcome",
      "priority",
      "trigger",
      "rateLimitType",
      "overageStatus",
      "overageDisabledReason",
      "stop_reason",
    ].includes(name)
  )
    return <span>{label(value)}</span>;

  return <ActivityValue value={value} depth={depth} />;
}

interface ActivityValueProps {
  value: unknown;
  depth?: number;
}

/** Safe, structured fallback for new SDK fields and nested tool payloads. */
export function ActivityValue({
  value,
  depth = 0,
}: ActivityValueProps): ReactNode {
  if (value === undefined) return null;
  if (value === null) return <span className="muted">None</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value !== "object")
    return <span className="activity-text">{String(value)}</span>;
  if (depth > MAX_ACTIVITY_DEPTH) return <NestedContentOmitted />;
  if (Array.isArray(value))
    return value.length ? (
      <ul className="activity-values">
        {value.map((item, index) => (
          <li key={index}>
            <ActivityValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    ) : (
      <span className="muted">None</span>
    );
  const fields = Object.entries(value).filter(([, item]) => item !== undefined);
  if (!fields.length) return null;

  return (
    <dl className="activity-fields">
      {fields.map(([key, item]) => (
        <div key={key}>
          <dt>{fieldLabels[key] ?? label(key)}</dt>
          <dd>
            {(["signature", "encrypted_content"].includes(key) ||
              (key === "data" && record(value).type === "base64")) &&
            typeof item === "string" ? (
              <span className="muted">
                Encoded content · inspect raw response
              </span>
            ) : (
              <FieldValue name={key} value={item} depth={depth + 1} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
