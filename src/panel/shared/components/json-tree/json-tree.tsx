import { useState } from "react";

import { Chevron } from "../chevron";

type JsonTreeProps = {
  value: unknown;
};

type JsonNodeProps = {
  /** The object key; array items and the root have none. */
  name?: string;
  /** Names the branch's toggle: its key, its item number, or "value" at the root. */
  label: string;
  value: unknown;
  depth: number;
  last: boolean;
};

/** JSON text whose objects and arrays fold. A folded branch renders no children. */
export function JsonTree({ value }: JsonTreeProps) {
  return (
    <div className="json-tree">
      <JsonNode value={value} label="value" depth={0} last />
    </div>
  );
}

function JsonKey({ name }: { name?: string }) {
  if (name === undefined) return null;

  return (
    <>
      <span className="json-key">{JSON.stringify(name)}</span>:{" "}
    </>
  );
}

/** A scalar's or an empty branch's JSON text. Values JSON can't encode show as text. */
function leafText(value: unknown) {
  if (Array.isArray(value)) return "[]";
  if (value !== null && typeof value === "object") return "{}";

  return (JSON.stringify(value) as string | undefined) ?? String(value);
}

function JsonNode({ name, label, value, depth, last }: JsonNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const comma = last ? "" : ",";
  const array = Array.isArray(value);

  let keys: string[] = [];

  if (array && open) {
    keys = Array.from({ length: value.length }, (_, index) => String(index));
  } else if (!array && value !== null && typeof value === "object") {
    keys = Object.keys(value).filter(
      (key) => Reflect.get(value, key) !== undefined,
    );
  }

  const size = array ? value.length : keys.length;

  if (!size) {
    return (
      <div className="json-line">
        <JsonKey name={name} />
        <span className={`json-${value === null ? "null" : typeof value}`}>
          {leafText(value)}
        </span>
        {comma}
      </div>
    );
  }

  const [start, end] = array ? ["[", "]"] : ["{", "}"];
  const count = `${size} ${array ? "item" : "key"}${size === 1 ? "" : "s"}`;

  return (
    <div className="json-branch">
      <div className="json-line">
        <button
          type="button"
          className="json-toggle"
          aria-expanded={open}
          aria-label={label || '""'}
          onClick={() => setOpen(!open)}
        >
          <Chevron size={8} />
        </button>
        <JsonKey name={name} />
        {start}
        {!open && (
          <>
            <span className="json-summary">{count}</span>
            {end}
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          <div className="json-children">
            {keys.map((key, index) => (
              <JsonNode
                key={key}
                name={array ? undefined : key}
                label={array ? `item ${key}` : key}
                value={Reflect.get(value as object, key)}
                depth={depth + 1}
                last={index === keys.length - 1}
              />
            ))}
          </div>
          <div className="json-line">
            {end}
            {comma}
          </div>
        </>
      )}
    </div>
  );
}
