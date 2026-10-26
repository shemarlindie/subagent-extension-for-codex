import type { CodexItem } from "../story";
import { CodexAppItem, type CodexEmbed } from "./codex-app-item";
import { CodexIcon } from "./codex-icon";
import { CodexText } from "./codex-text";

type CodexThreadItemProps = {
  item: CodexItem;
  /** Shown inline when the item is an app. */
  embed?: CodexEmbed;
};

/** One message, activity row, app or list in Codex's thread. */
export function CodexThreadItem({ item, embed }: CodexThreadItemProps) {
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
        </div>
      );
    case "app":
      return <CodexAppItem name={item.name} embed={embed} />;
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
