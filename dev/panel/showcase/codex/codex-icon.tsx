import { Icon } from "../../../../src/panel/shared/components/icons/icons";

// Approximations of Codex's 16px icons. Extension rows use the panel's own
// icon instead, as Codex does.
const paths = {
  files:
    "M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1 1 0 0 0-1-1h-4.5zM13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1 1 0 0 1 1-1h4.5z",
  mcp: "M8 1.8 13 3.6v4c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6v-4zM6 6.5l1.5 1.5L6 9.5M8.5 10h2",
  edit: "M10.5 2.5l3 3-7.5 7.5H3v-3zM9 4l3 3",
  terminal: "M2.5 3h11v10h-11zM5 6.5 6.8 8 5 9.5M8 10h3",
  plus: "M8 3v10M3 8h10",
  shield: "M8 1.8 13 3.6v4c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6v-4z",
  mic: "M8 2a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2zM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v3",
  expand: "M9.5 3H13v3.5M13 3 9 7M6.5 13H3V9.5M3 13l4-4",
  send: "M8 12.5v-9M4.5 7 8 3.5 11.5 7",
};

type CodexIconProps = {
  name: keyof typeof paths | "extension";
  className?: string;
};

export function CodexIcon({ name, className }: CodexIconProps) {
  if (name === "extension") {
    return <Icon name="quiet-constellation" size={16} className={className} />;
  }

  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
