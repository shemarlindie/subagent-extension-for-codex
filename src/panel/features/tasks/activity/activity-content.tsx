import type { ReactNode } from "react";

import { scalarText } from "../../../../shared/text";
import { MarkdownView } from "../../file-preview/markdown/markdown-view";
import { label, MAX_ACTIVITY_DEPTH, record } from "./activity-utils";
import { ActivityValue } from "./activity-value";
import { NestedContentOmitted } from "./nested-content-omitted";

export { ActivityValue };

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

    if (before) {
      parts.push(
        <p key={last} className="activity-text">
          {before}
        </p>,
      );
    }

    parts.push(
      <pre key={match.index} className="activity-code">
        {/* FENCE's one capture group is required, so every match has it. */}
        {match[1]!.replace(/\n$/, "")}
      </pre>,
    );

    last = match.index + match[0].length;
  }

  const rest = text.slice(last).trim();

  if (rest) {
    parts.push(
      <p key={last} className="activity-text">
        {rest}
      </p>,
    );
  }

  return <>{parts}</>;
}

/** The worker's own writing is Markdown; tool output and other text stay plain. */
function Text({ text, markdown }: { text: string; markdown: boolean }) {
  return markdown ? (
    <div className="activity-markdown">
      <MarkdownView content={text} />
    </div>
  ) : (
    <Prose text={text} />
  );
}

interface ActivityContentProps {
  content: unknown;
  depth?: number;
  /** Renders text and thinking as Markdown; tool results inside stay plain. */
  markdown?: boolean;
}

export function ActivityContent({
  content,
  depth = 0,
  markdown = false,
}: ActivityContentProps): ReactNode {
  if (
    content !== null &&
    typeof content === "object" &&
    depth > MAX_ACTIVITY_DEPTH
  ) {
    return <NestedContentOmitted />;
  }

  if (Array.isArray(content)) {
    return (
      <>
        {content.map((block, i) => (
          <ActivityContent
            key={i}
            content={block}
            depth={depth + 1}
            markdown={markdown}
          />
        ))}
      </>
    );
  }

  if (typeof content === "string") {
    return <Text text={content} markdown={markdown} />;
  }

  const block = record(content);
  const type = block.type;

  if (type === "opaque") {
    return (
      <ActivityContent
        content={block.data}
        depth={depth + 1}
        markdown={markdown}
      />
    );
  }

  if (type === "text" || type === "text_delta") {
    return (
      <>
        <Text text={scalarText(block.text)} markdown={markdown} />
        {block.citations != null && (
          <details>
            <summary>Citations</summary>
            <ActivityValue value={block.citations} depth={depth + 1} />
          </details>
        )}
      </>
    );
  }

  if (type === "thinking" || type === "thinking_delta") {
    return (
      <details className="activity-thinking">
        <summary>Thinking</summary>
        <Text text={scalarText(block.thinking)} markdown={markdown} />
      </details>
    );
  }

  if (type === "redacted_thinking") {
    return <p className="muted">Thinking is redacted.</p>;
  }

  if (type === "signature_delta") {
    return <p className="muted">Thinking signature received.</p>;
  }

  if (type === "input_json_delta") {
    return (
      <>
        <span className="muted">Tool input fragment</span>
        <pre>{scalarText(block.partial_json)}</pre>
      </>
    );
  }

  if (
    type === "tool_use" ||
    type === "server_tool_use" ||
    type === "mcp_tool_use"
  ) {
    return (
      <section>
        <p>{scalarText(block.name, "Tool call")}</p>
        <ActivityValue value={block.input} depth={depth + 1} />
      </section>
    );
  }

  if (type === "tool_result" || type === "mcp_tool_result") {
    return (
      <section>
        {block.is_error === true && <p className="error">Tool failed</p>}
        <ActivityContent content={block.content} depth={depth + 1} />
      </section>
    );
  }

  if (type === "image" || type === "document") {
    const source = record(block.source),
      mediaType = scalarText(source.media_type),
      data = typeof source.data === "string" ? source.data : undefined;

    const inlineImage =
      type === "image" &&
      source.type === "base64" &&
      data !== undefined &&
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        mediaType,
      );

    let body: ReactNode;

    if (inlineImage) {
      body = (
        <img
          className="activity-image"
          alt="Claude activity attachment"
          src={`data:${mediaType};base64,${data}`}
        />
      );
    } else if (source.type === "text") {
      body = <ActivityContent content={source.data} depth={depth + 1} />;
    } else if (source.type === "content") {
      body = <ActivityContent content={source.content} depth={depth + 1} />;
    } else {
      body = (
        <ActivityValue
          value={{ source: { ...source, data: undefined } }}
          depth={depth + 1}
        />
      );
    }

    return (
      <section>
        <p>
          {scalarText(block.title, type === "image" ? "Image" : "Document")}
        </p>
        {body}
      </section>
    );
  }

  if (!Object.keys(block).length) {
    return <ActivityValue value={content} depth={depth} />;
  }

  // Includes search/code results, citations, tool references and future blocks.
  const { type: _, ...fields } = block;

  return (
    <section>
      {typeof type === "string" && <p className="muted">{label(type)}</p>}
      <ActivityValue value={fields} depth={depth + 1} />
    </section>
  );
}
