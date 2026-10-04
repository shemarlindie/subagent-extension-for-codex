import { useForm, useWatch } from "react-hook-form";
import { Collapsible } from "@base-ui/react/collapsible";
import type { DialogState, SettingsDocument } from "../core/types";
import { useController, useSnapshot } from "../components/controller-context";
import {
  permissionLabels,
  claudeOverrideLabels,
} from "../../src/core/permissions";
import type { ModelChoice } from "../../src/core/model";
import { Chevron } from "../components/chevron";
import { Field } from "./fields";
import { FormFooter } from "./form-footer";
import { FormSelect } from "./form-select";
type Property = NonNullable<SettingsDocument["schema"]["properties"]>[string];
type Values = Record<string, string>;
// Mirrors native host rendering: layout groups first, then an "Other settings" group.
function groups(settings: SettingsDocument) {
  const properties = settings.schema.properties ?? {};
  const listed = (settings.layout ?? []).map((group) => ({
    title: group.title,
    keys: group.items
      .filter(
        (item) => item.kind === "property" && item.property! in properties,
      )
      .map((item) => item.property!),
  }));
  const seen = new Set(listed.flatMap((group) => group.keys));
  const other = Object.keys(properties).filter((key) => !seen.has(key));
  return [
    ...listed,
    ...(other.length ? [{ title: "Other settings", keys: other }] : []),
  ].filter((group) => group.keys.length);
}
type Models = Map<string, ModelChoice>;
// Blank models and "default" efforts defer to the next configured scope.
function display(name: string, value: string, models: Models) {
  if (name === "claude_permission_mode")
    return permissionLabels[value as keyof typeof permissionLabels] ?? value;
  if (claudeOverrideLabels[name]?.[value])
    return claudeOverrideLabels[name][value];
  if (name === "default_approval_decider")
    return value === "parent_agent" ? "Parent agent" : "User";
  if (value === "" || (name.endsWith("_effort") && value === "default"))
    return "Inherit";
  if (name.endsWith("_model") && models.has(value))
    return models.get(value)!.displayName;
  if (value === "true") return "On";
  if (value === "false") return "Off";
  return value;
}
function parse(field: Property, value: string) {
  if (field.type === "boolean") return value === "true";
  if (field.type === "number" || field.type === "integer") return Number(value);
  return value;
}
function SettingField({
  name,
  field,
  control,
  register,
  models,
}: {
  name: string;
  field: Property;
  models: Models;
  control: ReturnType<typeof useForm<Values>>["control"];
  register: ReturnType<typeof useForm<Values>>["register"];
}) {
  const id = `setting-${name}`,
    label = field.title ?? name,
    help = field.description?.trim() ? (
      <p id={`${id}-help`} className="help">
        {field.description.trim()}
      </p>
    ) : null;
  const options =
    field.type === "boolean"
      ? [
          { value: "true", label: "On" },
          { value: "false", label: "Off" },
        ]
      : field.enum?.map((value) => ({
          value,
          label: display(name, value, models),
          description: name.endsWith("_model")
            ? models.get(value)?.description
            : undefined,
        }));
  return (
    <div>
      <Field id={id} label={label}>
        {options ? (
          <FormSelect
            control={control}
            name={name}
            id={id}
            label={label}
            options={options}
            describedBy={help ? `${id}-help` : undefined}
          />
        ) : field.type === "number" || field.type === "integer" ? (
          <input
            id={id}
            type="number"
            min={field.minimum}
            max={field.maximum}
            step={field.type === "integer" ? 1 : "any"}
            required
            aria-describedby={help ? `${id}-help` : undefined}
            {...register(name, { required: true })}
          />
        ) : (
          <input
            id={id}
            type="text"
            maxLength={field.maxLength}
            aria-describedby={help ? `${id}-help` : undefined}
            {...register(name)}
          />
        )}
      </Field>
      {help}
    </div>
  );
}
/** Schema-driven fallback for hosts that do not render native plugin settings. */
export function SettingsForm({
  dialog,
}: {
  dialog: Extract<DialogState, { kind: "settings" }>;
}) {
  const controller = useController(),
    // Settings enums carry IDs only; discovered catalogs supply names and descriptions.
    models: Models = new Map(
      useSnapshot()
        .workers.flatMap((worker) => worker.models ?? [])
        .map((model) => [model.value, model]),
    ),
    { settings } = dialog,
    properties = settings.schema.properties ?? {};
  const initial = Object.fromEntries(
    Object.keys(properties).map((key) => [
      key,
      String(settings.values[key] ?? ""),
    ]),
  );
  const { control, register, handleSubmit } = useForm<Values>({
    defaultValues: initial,
  });
  const values = { ...initial, ...useWatch({ control }) } as Values,
    changed = Object.keys(initial).filter(
      (key) => values[key] !== initial[key],
    );
  return (
    <form
      className="settings-form"
      onSubmit={handleSubmit((submitted) => {
        // Like native hosts, send only changed fields.
        const set = Object.fromEntries(
          Object.entries(submitted)
            .filter(([key, value]) => value !== initial[key])
            .map(([key, value]) => [key, parse(properties[key], value)]),
        );
        return controller.submit(async () => {
          if (Object.keys(set).length)
            await controller.tool("update_agent_settings", { set });
        });
      })}
    >
      <p className="form-note">
        Settings control project registration and defaults for new tasks.
        Explicit task choices override task defaults, and existing tasks keep
        their original settings.
      </p>
      {groups(settings).map((group, index) => {
        const edits = group.keys.filter((key) => changed.includes(key)).length;
        return (
          <Collapsible.Root
            key={group.title}
            className="settings-group"
            defaultOpen={index === 0}
          >
            <Collapsible.Trigger className="settings-group-trigger">
              <Chevron square />
              <span className="settings-group-title">{group.title}</span>
              <span className="settings-group-summary">
                {group.keys
                  .map((key) => display(key, values[key], models))
                  .join(" · ")}
              </span>
              {edits > 0 && (
                <span className="settings-group-badge">{edits} changed</span>
              )}
            </Collapsible.Trigger>
            <Collapsible.Panel className="collapse-panel">
              <div className="settings-group-content">
                {group.keys.map((key) => (
                  <SettingField
                    key={key}
                    name={key}
                    field={properties[key]}
                    control={control}
                    register={register}
                    models={models}
                  />
                ))}
              </div>
            </Collapsible.Panel>
          </Collapsible.Root>
        );
      })}
      <FormFooter
        label={
          changed.length
            ? `Save ${changed.length} ${changed.length === 1 ? "change" : "changes"}`
            : "Save settings"
        }
        disabled={!changed.length}
      />
    </form>
  );
}
