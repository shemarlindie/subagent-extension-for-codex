import type { ReactNode } from "react";

type FixtureCheckProps = {
  checked: boolean;
  /** Disables the box in live mode, where `liveTitle` says what applies. */
  live: boolean;
  liveTitle: string;
  onChange: (checked: boolean) => void;
  children: ReactNode;
};

/** A host setting checkbox that applies only to fixture data. */
export function FixtureCheck({
  checked,
  live,
  liveTitle,
  onChange,
  children,
}: FixtureCheckProps) {
  return (
    <label className="settings-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={live}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span title={live ? liveTitle : undefined}>{children}</span>
    </label>
  );
}
