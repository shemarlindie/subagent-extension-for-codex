import { Switch } from "@base-ui/react/switch";
import { createContext, useContext } from "react";
import {
  type Control,
  Controller,
  type UseFormRegister,
  useFormState,
} from "react-hook-form";

import { Button } from "../components/button";
import { Presence } from "../components/motion";
import { workerProfileIconName } from "../components/worker-profile-icon";
import { FormSelect } from "./form-select";
import {
  helpId,
  type HelpPart,
  onKey,
  type SettingRow,
  type Values,
} from "./settings-layout";

/** The form bindings every settings control needs. */
export interface SettingsControls {
  control: Control<Values>;
  register: UseFormRegister<Values>;
}

/** What rows need from the dialog around them. */
export const SettingsContext = createContext<{
  /** Opens the section holding a setting and focuses its field. */
  show(setting: string): void;
  /** The title of the section holding a setting, for a link's tooltip. */
  sectionOf(setting: string): string | undefined;
  /** The keys of the section rendering a row; links into it stay plain. */
  current: string[];
  /** The current form values. */
  form: Values;
}>({
  show: () => {},
  sectionOf: () => undefined,
  current: [],
  form: {},
});

/** Help parts in order, with each explicit link to a setting as a button. */
export function LinkedText({ parts }: { parts: HelpPart[] }) {
  const settings = useContext(SettingsContext);

  return parts.map((part, index) => {
    if (typeof part === "string") return part;

    // A link stays plain text when its setting is in this section or missing.
    const section = settings.current.includes(part.setting)
      ? undefined
      : settings.sectionOf(part.setting);

    return section ? (
      <Button
        key={index}
        variant="text"
        underline
        title={`Show in ${section}`}
        onClick={() => settings.show(part.setting)}
      >
        {part.text}
      </Button>
    ) : (
      part.text
    );
  });
}

export function Help({ id, parts }: { id: string; parts?: HelpPart[] }) {
  return parts?.length ? (
    <p id={id} className="help">
      <LinkedText parts={parts} />
    </p>
  ) : null;
}

// Booleans live in form state as "true"/"false" strings.
function SettingSwitch({
  name,
  labelId,
  describedBy,
  control,
}: {
  name: string;
  labelId: string;
  describedBy?: string;
  control: Control<Values>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Switch.Root
          className="switch"
          checked={field.value === "true"}
          onCheckedChange={(checked) => field.onChange(String(checked))}
          onBlur={field.onBlur}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      )}
    />
  );
}

interface SettingRowProps extends SettingsControls {
  row: Exclude<SettingRow, { kind: "models" }>;
}

/** One setting: label and help beside a select, switch, or budget. */
export function SettingRowView({ row, control, register }: SettingRowProps) {
  const { form } = useContext(SettingsContext),
    id = `setting-${row.key}`,
    describedBy = row.help?.length ? helpId(row.key) : undefined;

  const { errors } = useFormState({ control, name: row.key }),
    error = errors[row.key],
    errorId = `${id}-error`;

  const text = (labelElement: React.ReactNode) => (
    <div className="setting-text">
      {labelElement}
      <Help id={helpId(row.key)} parts={row.help} />
    </div>
  );

  if (row.kind === "select")
    return (
      <div className="setting-row">
        {text(
          <label htmlFor={id} className="setting-label">
            {row.label}
          </label>,
        )}
        <div className="setting-control">
          <FormSelect
            control={control}
            name={row.key}
            id={id}
            label={row.label}
            options={row.options.map((option) => ({
              ...option,
              icon:
                row.key === "default_worker_profile"
                  ? workerProfileIconName(option.value)
                  : undefined,
            }))}
            describedBy={describedBy}
          />
        </div>
      </div>
    );

  const on = row.kind === "budget" && form[onKey(row.key)] === "true";

  return (
    <div className="setting-row setting-row-inline">
      {text(
        <span id={`${id}-label`} className="setting-label">
          {row.label}
        </span>,
      )}
      <div className="setting-control">
        {/* Turning the limit back on restores its remembered amount. */}
        {row.kind === "budget" && (
          <span className="setting-amount" data-off={!on || undefined}>
            <input
              id={id}
              type="number"
              inputMode="decimal"
              min={row.min}
              max={row.max}
              step="any"
              required={on}
              disabled={!on}
              aria-label={`${row.label} (${row.unit})`}
              aria-invalid={Boolean(error)}
              aria-describedby={
                [describedBy, error && errorId].filter(Boolean).join(" ") ||
                undefined
              }
              // The form checks this itself: closed sections are hidden,
              // where the browser cannot point to the field. A limit that is
              // off may be blank, but an amount it would restore must fit.
              {...register(row.key, {
                validate: (value, all) =>
                  (value === ""
                    ? all[onKey(row.key)] !== "true"
                    : Number(value) >= row.min && Number(value) <= row.max) ||
                  `Enter an amount from ${row.min} to ${row.max} ${row.unit}.`,
              })}
            />
            <span className="setting-unit">{row.unit}</span>
          </span>
        )}
        <SettingSwitch
          name={row.kind === "budget" ? onKey(row.key) : row.key}
          labelId={`${id}-label`}
          describedBy={
            [describedBy, error && errorId].filter(Boolean).join(" ") ||
            undefined
          }
          control={control}
        />
      </div>
      <Presence show={Boolean(error)}>
        <p id={errorId} className="form-error setting-error" role="alert">
          {error?.message}
        </p>
      </Presence>
    </div>
  );
}
