import { Chevron } from "../../../../shared/components/chevron";
import { LoadingSpinner } from "../../../../shared/components/loading-spinner/loading-spinner";

type ProfileSettingsToggleProps = {
  /** IDs of the controls the toggle shows and hides. */
  controls: string;
  expanded: boolean;
  /** The settings in effect, abbreviated, such as "Sonnet 5.5 · M · Ask". */
  summary: string;
  /** The same settings in full, for the label and tooltip. */
  description: string;
  loading: boolean;
  onToggle(): void;
};

/**
 * Collapsed, previews the model, reasoning and permission the profile sets
 * and opens them for editing. Expanded, it shrinks to a caret that closes them.
 */
export function ProfileSettingsToggle({
  controls,
  expanded,
  summary,
  description,
  loading,
  onToggle,
}: ProfileSettingsToggleProps) {
  return (
    <button
      type="button"
      className="profile-settings-toggle"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-label={expanded ? "Hide profile settings" : `Edit ${description}`}
      title={expanded ? "Hide profile settings" : `Edit ${description}`}
      disabled={loading}
      onClick={onToggle}
    >
      {!expanded && (
        <span className="profile-settings-summary">
          {loading ? "Loading settings" : summary}
        </span>
      )}
      <span className="profile-settings-caret" aria-hidden="true">
        {loading ? <LoadingSpinner /> : <Chevron size={10} />}
      </span>
    </button>
  );
}
