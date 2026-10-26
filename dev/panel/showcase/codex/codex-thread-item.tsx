import type { CodexItem } from "../story";
import { CodexIcon } from "./codex-icon";
import { CodexText } from "./codex-text";

type CodexThreadItemProps = { item: CodexItem };

/** One message, activity row or list in Codex's thread. */
export function CodexThreadItem({ item }: CodexThreadItemProps) {
  switch (item.kind) {
    case "user":
      return (
        <div className="codex-user">
          <CodexText text={item.text} />
        </div>
      );
    case "prose":
      return (
        <p className="codex-prose">
          <CodexText text={item.text} />
        </p>
      );
    case "row":
      return (
        <div className="codex-row">
          <CodexIcon
            name={item.icon}
            className={`codex-row-icon ${item.icon}`}
          />
          {item.text}
          {item.opens && <CodexIcon name="expand" />}
        </div>
      );
    case "list":
      return (
        <ul className="codex-list">
          {item.items.map((text) => (
            <li key={text}>
              <CodexText text={text} />
            </li>
          ))}
        </ul>
      );
  }
}
