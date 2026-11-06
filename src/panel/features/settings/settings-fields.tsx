import { createContext, useContext } from "react";
import {
  type Control,
  Controller,
  type UseFormRegister,
  useFormState,
} from "react-hook-form";

import { Button } from "../../shared/components/button/button";
import { AsyncControl } from "../../shared/forms/async-control";
import { FormFieldError } from "../../shared/forms/form-field-error";
import { FormSelect } from "../../shared/forms/form-select";
import { FormSwitch } from "../../shared/forms/form-switch";
import { descriptionIds } from "../../shared/utils/description-ids";
import { workerProfileIconName } from "../tasks/list/worker-profile-icon";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import {
  helpId,
  type HelpPart,
  rowFieldNames,
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
  /** Opens the section holding a setting path and focuses its field. */
  show(setting: string): void;
  /** The title of the section holding a setting path, for a link's tooltip. */
  sectionOf(setting: string): string | undefined;
  /** The paths of the section rendering a row. Links into it stay plain. */
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
function LinkedText({ parts }: { parts: HelpPart[] }) {
  const settings = useContext(SettingsContext);

  return parts.map((part, index) => {
    if (typeof part === "string") {
      return <SettingsSearchHighlight key={index} text={part} />;
    }

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
        <SettingsSearchHighlight text={part.text} />
      </Button>
    ) : (
      <SettingsSearchHighlight key={index} text={part.text} />
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
  loading,
}: {
  name: string;
  labelId: string;
  describedBy?: string;
  control: Control<Values>;
  loading: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormSwitch
          checked={field.value === "true"}
          onCheckedChange={(checked) => field.onChange(String(checked))}
          onBlur={field.onBlur}
          loading={loading}
          labelId={labelId}
          describedBy={describedBy}
        />
      )}
    />
  );
}

interface SettingRowProps extends SettingsControls {
  row: Exclude<SettingRow, { kind: "models" }>;
  loading?: boolean;
  searchNoteId?: string;
}

/** One setting: label and help beside a select, switch, or budget. */
export function SettingRowView({
  row,
  control,
  register,
  loading = false,
  searchNoteId,
}: SettingRowProps) {
  const { form } = useContext(SettingsContext),
    { name, enabledName } = rowFieldNames(row),
    id = `setting-${name}`,
    describedBy = descriptionIds(
      row.help?.length ? helpId(row.path) : undefined,
      searchNoteId,
    );

  const { errors } = useFormState({ control, name }),
    error = errors[name],
    errorId = `${id}-error`,
    describedByWithError = descriptionIds(describedBy, error && errorId);

  const text = (labelElement: React.ReactNode) => (
    <div className="setting-text">
      {labelElement}
      <Help id={helpId(row.path)} parts={row.help} />
      {row.kind === "select" && row.warning && (
        <p className="help warn">{row.warning}</p>
      )}
    </div>
  );

  const withLoading = (child: React.ReactNode, label: string) =>
    loading ? (
      <AsyncControl loading label={label}>
        {child}
      </AsyncControl>
    ) : (
      child
    );

  if (row.kind === "select") {
    return (
      <div className="setting-row">
        {text(
          <label htmlFor={id} className="setting-label">
            <SettingsSearchHighlight text={row.label} />
          </label>,
        )}
        <div className="setting-control">
          <FormSelect
            control={control}
            name={name}
            id={id}
            label={row.label}
            options={row.options.map((option) => ({
              ...option,
              icon:
                row.path === "task.worker_profile"
                  ? workerProfileIconName(option.value)
                  : undefined,
            }))}
            describedBy={describedBy}
            disabled={loading}
            loading={loading}
            loadingLabel={`Loading ${row.label.toLowerCase()}`}
            placeholder={loading ? "Loading…" : undefined}
          />
        </div>
      </div>
    );
  }

  if (row.kind === "text") {
    return (
      <div className="setting-row">
        {text(
          <label htmlFor={id} className="setting-label">
            <SettingsSearchHighlight text={row.label} />
          </label>,
        )}
        <div className="setting-control">
          {withLoading(
            <input
              id={id}
              type="text"
              spellCheck={false}
              autoComplete="off"
              maxLength={row.maxLength}
              disabled={loading}
              aria-invalid={Boolean(error)}
              aria-describedby={describedByWithError}
              // Checked by the form, like budgets: inactive panels are hidden.
              {...register(name, {
                validate: (value) =>
                  new RegExp(`^(?:${row.pattern})$`).test(value) ||
                  `${row.label} has characters a branch name can't use.`,
              })}
            />,
            `Loading ${row.label.toLowerCase()}`,
          )}
        </div>
        <FormFieldError
          id={errorId}
          className="setting-error"
          message={error?.message}
        />
      </div>
    );
  }

  const on = enabledName !== undefined && form[enabledName] === "true";

  return (
    <div className="setting-row setting-row-inline">
      {text(
        <span id={`${id}-label`} className="setting-label">
          <SettingsSearchHighlight text={row.label} />
        </span>,
      )}
      <div className="setting-control">
        {/* Turning the limit back on restores its remembered amount. */}
        {row.kind === "budget" && (
          <span className="setting-amount" data-off={!on || undefined}>
            {withLoading(
              <input
                id={id}
                type="number"
                inputMode="decimal"
                min={row.min}
                max={row.max}
                step="any"
                required={on}
                disabled={!on || loading}
                aria-label={`${row.label} (${row.unit})`}
                aria-invalid={Boolean(error)}
                aria-describedby={describedByWithError}
                // The form checks this itself: inactive panels are hidden,
                // where the browser cannot point to the field. A limit that is
                // off may be blank, but an amount it would restore must fit.
                {...register(name, {
                  validate: (value, all) =>
                    (value === ""
                      ? all[enabledName ?? ""] !== "true"
                      : Number.isFinite(Number(value)) &&
                        Number(value) >= row.min &&
                        (row.max === undefined || Number(value) <= row.max)) ||
                    (row.max === undefined
                      ? `Enter an amount of at least ${row.min} ${row.unit}.`
                      : `Enter an amount from ${row.min} to ${row.max} ${row.unit}.`),
                })}
              />,
              `Loading ${row.label.toLowerCase()}`,
            )}
            <span className="setting-unit">{row.unit}</span>
          </span>
        )}
        <SettingSwitch
          name={enabledName ?? name}
          labelId={`${id}-label`}
          describedBy={describedByWithError}
          control={control}
          loading={loading}
        />
      </div>
      <FormFieldError
        id={errorId}
        className="setting-error"
        message={error?.message}
      />
    </div>
  );
}
