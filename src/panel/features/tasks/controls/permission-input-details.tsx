function labelFor(key: string) {
  return key
    .replaceAll(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isCommandKey(key: string) {
  return key === "command" || key.endsWith("_command");
}

function PermissionValue({
  value,
  command = false,
}: {
  value: unknown;
  command?: boolean;
}) {
  if (typeof value === "string") {
    return command ? (
      <pre className="permission-command">
        <code>{value}</code>
      </pre>
    ) : (
      <div className="permission-value-text">{value}</div>
    );
  }

  if (value === null || typeof value !== "object") {
    return <code className="permission-scalar">{String(value)}</code>;
  }

  if (Array.isArray(value)) {
    return value.length ? (
      <ul className="permission-value-list">
        {value.map((item, index) => (
          <li key={index}>
            <PermissionValue value={item} command={command} />
          </li>
        ))}
      </ul>
    ) : (
      <span className="permission-empty">Empty list</span>
    );
  }

  const entries = Object.entries(value);

  return entries.length ? (
    <dl className="permission-nested-details">
      {entries.map(([key, nested]) => (
        <div key={key}>
          <dt>{labelFor(key)}</dt>
          <dd>
            <PermissionValue value={nested} command={isCommandKey(key)} />
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <span className="permission-empty">Empty object</span>
  );
}

export function PermissionInputDetails({
  input,
}: {
  input: Record<string, unknown>;
}) {
  const entries = Object.entries(input);

  if (!entries.length) {
    return <p className="permission-empty">No additional details provided.</p>;
  }

  return (
    <dl className="permission-details" aria-label="Permission request details">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className={key === "description" ? "visually-hidden" : ""}>
            {labelFor(key)}
          </dt>
          <dd>
            {key === "description" && typeof value === "string" ? (
              <div className="permission-request-description">{value}</div>
            ) : (
              <PermissionValue value={value} command={isCommandKey(key)} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
