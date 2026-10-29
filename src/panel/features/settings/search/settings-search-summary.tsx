import { useEffect, useState } from "react";

import { Button } from "../../../shared/components/button/button";

interface SettingsSearchSummaryProps {
  query: string;
  results: number;
  sections: number;
  onClear: () => void;
}

export function SettingsSearchSummary({
  query,
  results,
  sections,
  onClear,
}: SettingsSearchSummaryProps) {
  const text = results
      ? `${results} ${results === 1 ? "result" : "results"} across ${sections} ${sections === 1 ? "section" : "sections"}`
      : `No settings match “${query.trim()}”.`,
    [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnouncement(text), 200);

    return () => window.clearTimeout(timeout);
  }, [text]);

  return (
    <div className="settings-search-summary">
      <p>{text}</p>
      <span
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
      {!results && (
        <>
          <p>
            Try fewer words or a setting name, such as “model” or “runtime”.
          </p>
          <Button variant="text" underline onClick={onClear}>
            Clear search
          </Button>
        </>
      )}
    </div>
  );
}
