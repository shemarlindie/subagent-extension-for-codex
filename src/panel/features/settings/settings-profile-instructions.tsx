import { Collapsible } from "@base-ui/react/collapsible";
import type { UseFormRegister } from "react-hook-form";

import { descriptionIds } from "../../shared/utils/description-ids";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import { Help } from "./settings-fields";
import { fieldName, type ProseSetting, type Values } from "./settings-layout";

interface ProfileInstructionsProps {
  setting: ProseSetting;
  register: UseFormRegister<Values>;
  describedBy?: string;
}

/** A worker profile's instructions, opened from its name in the model table. */
export function ProfileInstructions({
  setting,
  register,
  describedBy,
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
          <SettingsSearchHighlight text="Custom instructions" />
        </label>
        <Help id={`${id}-help`} parts={setting.help} />
        <textarea
          id={id}
          rows={3}
          maxLength={setting.maxLength}
          // Names the profile too, since every profile has this field.
          aria-label={setting.label}
          aria-describedby={descriptionIds(
            setting.help?.length ? `${id}-help` : undefined,
            describedBy,
          )}
          {...register(name)}
        />
      </div>
    </Collapsible.Panel>
  );
}
