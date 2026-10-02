import type { Result } from "../../src/model";
const sections = [
  "findings",
  "evidence",
  "changes",
  "tests",
  "recommendations",
] as const;
export function ResultReport({ result }: { result?: Result }) {
  return result ? (
    <div className="report">
      <p>{result.summary}</p>
      {sections.map((section) => (
        <section key={section}>
          <h3>{section[0].toUpperCase() + section.slice(1)}</h3>
          {result[section].length ? (
            <ul>
              {result[section].map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          ) : (
            <p className="help">None reported</p>
          )}
        </section>
      ))}
    </div>
  ) : (
    <p className="muted">
      The worker’s summary and evidence appear here when the task finishes.
    </p>
  );
}
