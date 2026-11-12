import { useState } from "react";

import { previewOrgPolicy } from "../scenarios/preview-models";
import { orgPolicyJson, parseOrgPolicy } from "./host-helpers";

const EXAMPLE = orgPolicyJson(previewOrgPolicy);

type Props = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

/**
 * The fixture org policy as JSON. Edits apply when the field loses focus, as
 * each one starts a new panel session.
 */
export function OrgPolicyField({ value, disabled, onChange }: Props) {
  const [draft, setDraft] = useState(value);
  const invalid = draft.trim() !== "" && !parseOrgPolicy(draft);

  let hint = "The policy as discovery reports it. Leave blank for none.";
  if (invalid) hint = "Invalid JSON, so no policy applies.";
  if (disabled) hint = "The live service reads your organization's policy.";

  const apply = (text: string) => {
    setDraft(text);
    onChange(text);
  };

  return (
    <div className="org-policy-field">
      <label>
        Org policy (JSON)
        <textarea
          rows={10}
          value={draft}
          disabled={disabled}
          placeholder='{"default_effort": "high"}'
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => apply(draft)}
        />
        <small>{hint}</small>
      </label>
      <button type="button" disabled={disabled} onClick={() => apply(EXAMPLE)}>
        Insert example
      </button>
    </div>
  );
}
