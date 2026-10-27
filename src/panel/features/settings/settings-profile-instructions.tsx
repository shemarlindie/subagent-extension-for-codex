import { Collapsible } from "@base-ui/react/collapsible";
import type { UseFormRegister } from "react-hook-form";

import { fieldName, type ProseSetting, type Values } from "./settings-layout";

interface ProfileInstructionsProps {
  setting: ProseSetting;
  register: UseFormRegister<Values>;
}

/** A worker profile's instructions, opened from its name in the model table. */
export function ProfileInstructions({
  setting,
  register,
}: ProfileInstructionsProps) {
  const name = fieldName(setting.path),
    id = `setting-${name}`;

  return (
    <Collapsible.Panel
      className="profile-instructions collapse-panel"
      keepMounted
    >
      <div className="profile-instructions-content">
        <label htmlFor={id} className="setting-label">
          Custom instructions
        </label>
        <textarea
          id={id}
          rows={3}
          maxLength={setting.maxLength}
          // Names the profile too, since every profile has this field.
          aria-label={setting.label}
          placeholder={setting.help
            ?.map((part) => (typeof part === "string" ? part : part.text))
            .join("")}
          {...register(name)}
        />
      </div>
    </Collapsible.Panel>
  );
}
