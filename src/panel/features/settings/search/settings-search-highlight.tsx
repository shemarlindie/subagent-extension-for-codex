import { useContext } from "react";

import { SettingsSearchContext } from "./settings-search-context";

interface SettingsSearchHighlightProps {
  text: string;
}

/** Highlight literal query terms without injecting HTML into settings prose. */
export function SettingsSearchHighlight({
  text,
}: SettingsSearchHighlightProps) {
  const { terms } = useContext(SettingsSearchContext);
  if (!terms.length) return text;

  const pattern = new RegExp(
    `(${terms
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length)
      .join("|")})`,
    "gi",
  );

  // One wrapper keeps the split text a single item in flex labels, whose gap
  // would otherwise separate a highlight from the rest of its word.
  return (
    <span>
      {text.split(pattern).map((part, index) =>
        terms.includes(part.toLowerCase()) ? (
          <mark key={index} className="settings-search-highlight">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  );
}
