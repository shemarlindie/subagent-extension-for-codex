import { settingHelp } from "../../../shared/settings/settings-schema";
import { roles } from "../../../shared/tasks/model";
import { titleCase } from "../../../shared/text";
import { SelectField } from "../../shared/components/select/select-field";
import { AsyncControl } from "../../shared/forms/async-control";
import { FormSwitch } from "../../shared/forms/form-switch";
import { Help } from "./settings-fields";

/** Stable task-default controls stay visible while the settings read is pending. */
export function SettingsLoadingTaskDefaults() {
  const selectRows = [
    { label: "Provider", key: "provider", options: [] },
    {
      label: "Worker profile",
      key: "worker-profile",
      options: roles.map((value) => ({ value, label: titleCase(value) })),
    },
    {
      label: "Workspace",
      key: "workspace",
      options: [
        { value: "current_repo", label: "Current repository" },
        { value: "worktree", label: "Isolated worktree" },
      ],
    },
  ];

  return (
    <>
      <div className="settings-loading-rows">
        {selectRows.map(({ label, key, options }) => (
          <div className="setting-row" key={key}>
            <div className="setting-text">
              <label
                htmlFor={`settings-loading-${key}`}
                className="setting-label"
              >
                {label}
              </label>
            </div>
            <div className="setting-control">
              <SelectField
                id={`settings-loading-${key}`}
                label={label}
                options={options}
                value=""
                placeholder="Loading…"
                disabled
                loading
                loadingLabel={`Loading ${label.toLowerCase()}`}
                onValueChange={() => {}}
              />
            </div>
          </div>
        ))}
        <div className="setting-row">
          <div className="setting-text">
            <label
              htmlFor="settings-loading-worktree-prefix"
              className="setting-label"
            >
              Worktree branch prefix
            </label>
            <Help
              id="settings-loading-worktree-prefix-help"
              parts={[settingHelp.worktree_branch_prefix]}
            />
          </div>
          <div className="setting-control">
            <AsyncControl loading label="Loading worktree branch prefix">
              <input
                id="settings-loading-worktree-prefix"
                className="settings-loading-input"
                type="text"
                disabled
              />
            </AsyncControl>
          </div>
        </div>
        {(
          [
            ["Cost limit", "USD"],
            ["Runtime limit", "mins"],
          ] as const
        ).map(([label, unit]) => (
          <div className="setting-row setting-row-inline" key={label}>
            <span className="setting-label">{label}</span>
            <div className="setting-control">
              <span className="setting-amount">
                <AsyncControl loading label={`Loading ${label.toLowerCase()}`}>
                  <input
                    className="settings-loading-input"
                    type="number"
                    disabled
                  />
                </AsyncControl>
                <span className="setting-unit">{unit}</span>
              </span>
              <FormSwitch checked={false} loading decorative />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
