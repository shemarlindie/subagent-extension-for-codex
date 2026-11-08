import { Switch } from "@base-ui/react/switch";

import type { SessionDeletionStatus } from "../../../../shared/providers/types.js";

type AgentTaskDeletionOptionProps = {
  id: string;
  label: string;
  checked: boolean;
  busy: boolean;
  sessionDeletion?: SessionDeletionStatus;
  onCheckedChange: (checked: boolean) => void;
  onBlur?: () => void;
};

/** Offers provider session removal only after the service verifies the files. */
export function AgentTaskDeletionOption({
  id,
  label,
  checked,
  busy,
  sessionDeletion,
  onCheckedChange,
  onBlur,
}: AgentTaskDeletionOptionProps) {
  return (
    <div className="delete-option">
      <div className="delete-option-text">
        <span id={`${id}-label`}>{label}</span>
        <span id={`${id}-help`} className="form-note">
          {sessionDeletion?.available
            ? "Deletes the recorded session files shown below."
            : (sessionDeletion?.message ?? "Checking session files…")}
        </span>
      </div>
      <Switch.Root
        className="switch"
        checked={checked}
        // A switch left on after the files change stays enabled so it can be turned off.
        disabled={busy || (!sessionDeletion?.available && !checked)}
        onCheckedChange={onCheckedChange}
        onBlur={onBlur}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
      >
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}
