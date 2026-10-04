import type { ReactNode } from "react";

const MAX_ACTIVITY_DEPTH = 6;
function NestedContentOmitted() {
  return (
    <span className="muted">Nested content omitted · inspect raw response</span>
  );
}

// A closed ``` fence with an optional info string; group 1 is the code. Unclosed
// fences (still streaming) do not match and stay plain text.
const FENCE = /```[^\n`]*\n([\s\S]*?)```/g;
/** Plain text with fenced code blocks shown as code; no other markdown. */
function Prose({ text }: { text: string }): ReactNode {
  if (!text.includes("```")) return <p className="activity-text">{text}</p>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const before = text.slice(last, match.index).trim();
    if (before)
      parts.push(
        <p key={last} className="activity-text">
          {before}
        </p>,
      );
    parts.push(
      <pre key={match.index} className="activity-code">
        {match[1].replace(/\n$/, "")}
      </pre>,
    );
    last = match.index + match[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest)
    parts.push(
      <p key={last} className="activity-text">
        {rest}
      </p>,
    );
  return <>{parts}</>;
}

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const label = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
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
function FieldValue({
  name,
  value,
  depth,
}: {
  name: string;
  value: unknown;
  depth: number;
}): ReactNode {
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

/** Safe, structured fallback for new SDK fields and nested tool payloads. */
export function ActivityValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): ReactNode {
  if (value === undefined) return null;
  if (value === null) return <span className="muted">None</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value !== "object")
    return <span className="activity-text">{String(value)}</span>;
  if (depth > MAX_ACTIVITY_DEPTH) return <NestedContentOmitted />;
  if (Array.isArray(value))
    return value.length ? (
      <ul className="activity-values">
        {value.map((item, i) => (
          <li key={i}>
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

export function ActivityContent({
  content,
  depth = 0,
}: {
  content: unknown;
  depth?: number;
}): ReactNode {
  if (
    content !== null &&
    typeof content === "object" &&
    depth > MAX_ACTIVITY_DEPTH
  )
    return <NestedContentOmitted />;
  if (Array.isArray(content))
    return (
      <>
        {content.map((block, i) => (
          <ActivityContent key={i} content={block} depth={depth + 1} />
        ))}
      </>
    );
  if (typeof content === "string") return <Prose text={content} />;
  const block = record(content);
  const type = block.type;
  if (type === "text" || type === "text_delta")
    return (
      <>
        <Prose text={String(block.text ?? "")} />
        {block.citations != null && (
          <details>
            <summary>Citations</summary>
            <ActivityValue value={block.citations} depth={depth + 1} />
          </details>
        )}
      </>
    );
  if (type === "thinking" || type === "thinking_delta")
    return (
      <details className="activity-thinking">
        <summary>Thinking</summary>
        <p className="activity-text">{String(block.thinking ?? "")}</p>
      </details>
    );
  if (type === "redacted_thinking")
    return <p className="muted">Thinking is redacted.</p>;
  if (type === "signature_delta")
    return <p className="muted">Thinking signature received.</p>;
  if (type === "input_json_delta")
    return (
      <>
        <span className="muted">Tool input fragment</span>
        <pre>{String(block.partial_json ?? "")}</pre>
      </>
    );
  if (
    type === "tool_use" ||
    type === "server_tool_use" ||
    type === "mcp_tool_use"
  )
    return (
      <section>
        <p>{String(block.name ?? "Tool call")}</p>
        <ActivityValue value={block.input} depth={depth + 1} />
      </section>
    );
  if (type === "tool_result" || type === "mcp_tool_result")
    return (
      <section>
        {block.is_error === true && <p className="error">Tool failed</p>}
        <ActivityContent content={block.content} depth={depth + 1} />
      </section>
    );
  if (type === "image" || type === "document") {
    const source = record(block.source);
    const inlineImage =
      type === "image" &&
      source.type === "base64" &&
      typeof source.data === "string" &&
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        String(source.media_type),
      );
    return (
      <section>
        <p>
          {String(block.title ?? (type === "image" ? "Image" : "Document"))}
        </p>
        {inlineImage ? (
          <img
            className="activity-image"
            alt="Claude activity attachment"
            src={`data:${source.media_type};base64,${source.data}`}
          />
        ) : source.type === "text" ? (
          <ActivityContent content={source.data} depth={depth + 1} />
        ) : source.type === "content" ? (
          <ActivityContent content={source.content} depth={depth + 1} />
        ) : (
          <ActivityValue
            value={{ source: { ...source, data: undefined } }}
            depth={depth + 1}
          />
        )}
      </section>
    );
  }
  if (!Object.keys(block).length)
    return <ActivityValue value={content} depth={depth} />;
  // Includes search/code results, citations, tool references and future blocks.
  const { type: _, ...fields } = block;
  return (
    <section>
      {typeof type === "string" && <p className="muted">{label(type)}</p>}
      <ActivityValue value={fields} depth={depth + 1} />
    </section>
  );
}
