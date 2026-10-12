import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type FieldErrors, useWatch } from "react-hook-form";

import { settingsSections as buildSettingsSections } from "../../../shared/settings/settings-document";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/motion";
import { reducedMotion } from "../../shared/components/motion/motion-utils";
import { Notice } from "../../shared/components/notice/notice";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import {
  usePersistedDialogField,
  usePersistedDialogForm,
} from "../../shared/forms/use-persisted-dialog-form";
import {
  Help,
  SettingRowView,
  SettingsContext,
  type SettingsControls,
} from "./settings-fields";
import {
  activeSection,
  changes,
  differs,
  editCount,
  rowForm,
  sectionKeys,
  sectionsForm,
  type SettingSection,
  type Values,
} from "./settings-layout";
import { SettingsLoadingTaskDefaults } from "./settings-loading-task-defaults";
import { ModelTable } from "./settings-model-table";
import {
  SettingsSectionTabs,
  type SettingsSectionView,
} from "./settings-section-tabs";

export type SettingsFormDialog =
  | Extract<DialogState, { kind: "settings" }>
  | Extract<DialogState, { kind: "settings-loading" }>;

export interface SettingsSaveActionState {
  disabled: boolean;
  label: string;
}

interface SettingsFormProps {
  dialog: SettingsFormDialog;
  saveActionPlacement?: "header" | "footer";
  onSaveActionChange?: (state: SettingsSaveActionState) => void;
}

interface LoadingSettingsSectionProps extends SettingsControls {
  section: SettingSection;
}

function LoadingSettingsSection({
  section,
  control,
  register,
}: LoadingSettingsSectionProps) {
  const keys = sectionKeys(section);

  return (
    <SettingsContext.Provider
      value={{
        show: () => {},
        sectionOf: () => undefined,
        current: keys,
        form: {},
      }}
    >
      <div className="settings-section-intro">
        <Help id={`settings-${section.id}-help`} parts={section.help} />
      </div>
      {section.rows.map((row) =>
        row.kind === "models" ? (
          <ModelTable
            key="models"
            scopes={row.scopes}
            control={control}
            register={register}
            loading
            reserveProviderScope={section.id === "models"}
          />
        ) : (
          <SettingRowView
            key={row.key}
            row={row}
            control={control}
            register={register}
            loading
          />
        ),
      )}
    </SettingsContext.Provider>
  );
}

// Use the shared settings definitions for all structure that is known before
// the settings read. Dynamic provider scopes are added after the read returns.
const loadingSections = buildSettingsSections({
  values: {},
  providers: [],
  catalogs: [],
  modelProviders: [],
  shown: {},
  remembered: { max_cost_usd: 5, max_runtime_minutes: 20 },
});

/** One settings form and section tabs for both loading and loaded data. */
export function SettingsForm({
  dialog,
  saveActionPlacement = "footer",
  onSaveActionChange,
}: SettingsFormProps) {
  const controller = useController(),
    state = useSnapshot(),
    loading = dialog.kind === "settings-loading",
    settings = loading ? undefined : dialog.settings,
    status = loading ? dialog.status : "ready",
    loadError = loading ? dialog.error : undefined,
    sections = useMemo(() => settings?.sections ?? [], [settings?.sections]),
    initial = useMemo(
      () => sectionsForm(sections, settings?.values ?? {}),
      [sections, settings?.values],
    );

  const { control, register, handleSubmit, setValue, reset } =
    usePersistedDialogForm<Values>("settings", initial, { ready: !loading });

  const baseline = useRef(initial),
    previousSettings = useRef(settings);

  if (settings && previousSettings.current !== settings) {
    baseline.current = initial;
    previousSettings.current = settings;
  }

  const form = { ...initial, ...useWatch({ control }) } as Values,
    edits = sections.map((section) =>
      editCount(section, form, baseline.current),
    ),
    total = edits.reduce((sum, count) => sum + count, 0);

  const [selection, setSelection] = usePersistedDialogField(
      "settings",
      "openSections",
      [controller.getLastSettingsSection()],
    ),
    [discarding, setDiscarding] = useState(false),
    element = useRef<HTMLFormElement>(null),
    discardPrompt = useRef<HTMLDivElement>(null);

  const isLoading = status === "loading",
    isError = status === "error",
    showDiscard = !loading && discarding && total > 0;

  const saveButtonDisabled = state.busy || !settings || !total,
    saveButtonLabel = state.busy
      ? "Working…"
      : total
        ? `Save ${total} ${total === 1 ? "change" : "changes"}`
        : "Save";

  useEffect(() => {
    onSaveActionChange?.({
      disabled: saveButtonDisabled,
      label: saveButtonLabel,
    });
  }, [onSaveActionChange, saveButtonDisabled, saveButtonLabel]);

  useEffect(() => {
    if (!showDiscard) return;
    const prompt = discardPrompt.current;
    if (!prompt) return;
    let cancelled = false;

    const reveal = () => {
      if (cancelled) return;

      prompt
        .querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });

      prompt.scrollIntoView({
        block: "start",
        behavior: reducedMotion(prompt) ? "instant" : "smooth",
      });
    };

    if (typeof prompt.getAnimations !== "function") {
      reveal();

      return;
    }

    // Wait until Base UI removes its starting styles, then wait for the
    // resulting height transition. Scrolling uses the final expanded bounds.
    let waiting = false;

    const finishExpansion = async () => {
      if (waiting || prompt.hasAttribute("data-starting-style")) return;
      waiting = true;
      prompt.getBoundingClientRect();

      await Promise.allSettled(
        prompt.getAnimations().map((animation) => animation.finished),
      );

      reveal();
    };

    const observer = new MutationObserver(() => void finishExpansion());

    observer.observe(prompt, {
      attributes: true,
      attributeFilter: ["data-starting-style"],
    });

    void finishExpansion();

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [showDiscard]);

  // Leaving with unsaved edits asks first; saving keeps the page open.
  const dirty = useRef(false);
  dirty.current = total > 0;

  useEffect(() => {
    controller.guardDismiss(() => {
      if (!dirty.current) return true;
      setDiscarding(true);

      return false;
    });

    return () => controller.guardDismiss(undefined);
  }, [controller]);

  const sectionOf = (key: string) =>
    sections.find((section) => sectionKeys(section).includes(key));

  const selectSection = (section: string) => {
    setSelection([section]);
    controller.saveSettingsSection(section);
  };

  // Opens the section holding a setting and focuses its field.
  const reveal = (key: string) => {
    const section = sectionOf(key);
    if (!section) return;
    flushSync(() => selectSection(section.id));

    const field = element.current?.querySelector<HTMLInputElement>(
      `#setting-${key}`,
    );

    // Disabled amounts cannot take focus; their switch restores editing.
    if (field?.disabled)
      field
        .closest(".setting-row")
        ?.querySelector<HTMLElement>('[role="switch"]')
        ?.focus();
    else field?.focus();

    return field;
  };

  // An invalid field may sit in an inactive tab: reveal it and show why.
  const showInvalid = (errors: FieldErrors<Values>) => {
    const key = sections.flatMap(sectionKeys).find((name) => name in errors);

    if (key) reveal(key)?.reportValidity();
  };

  const apply = (entries: Values) => {
    for (const [key, value] of Object.entries(entries))
      setValue(key, value, { shouldDirty: true });
  };

  const sectionViews: SettingsSectionView[] = settings
    ? sections.map((section, index) => {
        const keys = sectionKeys(section),
          resets = Object.assign(
            {},
            ...section.rows.map((row) => rowForm(row, settings.defaults)),
          ) as Values;

        return {
          id: section.id,
          title: section.title,
          edits: edits[index],
          content: (
            <SettingsContext.Provider
              value={{
                show: reveal,
                sectionOf: (key) => sectionOf(key)?.title,
                current: keys,
                form,
              }}
            >
              <div className="settings-section-intro">
                <Help id={`settings-${section.id}-help`} parts={section.help} />
              </div>
              {section.rows.map((row) =>
                row.kind === "models" ? (
                  <ModelTable
                    key="models"
                    scopes={row.scopes}
                    control={control}
                    register={register}
                  />
                ) : (
                  <SettingRowView
                    key={row.key}
                    row={row}
                    control={control}
                    register={register}
                  />
                ),
              )}
              {/* Shown only while something here differs from its default. */}
              <Presence show={differs(resets, form)}>
                <div className="settings-section-footer">
                  <Button
                    variant="text"
                    underline
                    className="setting-reset"
                    onClick={() => apply(resets)}
                  >
                    Reset to defaults
                  </Button>
                </div>
              </Presence>
            </SettingsContext.Provider>
          ),
        };
      })
    : loadingSections.map((section) => ({
        id: section.id,
        title: section.title,
        content:
          section.id === "task" ? (
            <SettingsLoadingTaskDefaults />
          ) : (
            <LoadingSettingsSection
              section={section}
              control={control}
              register={register}
            />
          ),
      }));

  const sectionSelection = activeSection(selection, sectionViews);

  const submit = handleSubmit((submitted) => {
    if (!settings) return;
    const set = changes(sections, submitted, baseline.current);

    return controller.submit(
      async () => {
        if (Object.keys(set).length)
          await controller.tool("update_agent_settings", { set });
      },
      false,
      () => {
        baseline.current = { ...submitted };
        reset(submitted, { keepValues: true });
        setDiscarding(false);
      },
      false,
    );
  }, showInvalid);

  return (
    <form
      ref={element}
      id="settings-form"
      className="settings-form"
      noValidate
      aria-busy={isLoading || undefined}
      onSubmit={loading ? (event) => event.preventDefault() : submit}
    >
      <Collapsible.Root open={showDiscard}>
        <Collapsible.Panel
          ref={discardPrompt}
          className="settings-discard-anchor collapse-panel"
          keepMounted
          role={showDiscard ? "alert" : undefined}
        >
          <Notice className="settings-discard">
            <strong>Discard unsaved changes?</strong>
            <Button variant="primary" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                controller.guardDismiss(undefined);
                controller.backFromSettings();
              }}
            >
              Discard
            </Button>
          </Notice>
        </Collapsible.Panel>
      </Collapsible.Root>
      <div
        className={`settings-form-body${loading ? " settings-loading-body" : ""}`}
      >
        <Presence show={!isError}>
          <div
            className={
              isLoading
                ? "loading-skeleton settings-loading-skeleton"
                : "settings-sections-layer"
            }
          >
            <SettingsSectionTabs
              sections={sectionViews}
              value={sectionSelection ?? ""}
              loading={isLoading}
              onValueChange={selectSection}
            />
          </div>
        </Presence>
        <Presence show={isError}>
          <div className="settings-loading-error">
            <p className="form-error form-field-error" role="alert">
              {loadError}
              {loading && !loadError ? "Settings could not be loaded." : null}
            </p>
            <Button
              variant="primary"
              onClick={() => controller.retryDialogLoad()}
            >
              Retry
            </Button>
          </div>
        </Presence>
      </div>
      <Presence show={Boolean(state.formError)}>
        <div id="form-error" className="form-error error" role="alert">
          {state.formError}
        </div>
      </Presence>
      {saveActionPlacement === "footer" && (
        <footer className="settings-form-footer">
          <Button
            id="submit"
            type="submit"
            variant="primary"
            disabled={saveButtonDisabled}
          >
            {saveButtonLabel}
          </Button>
        </footer>
      )}
    </form>
  );
}

const settingsTitle = () => "Settings",
  renderSettingsDialog = (dialog: SettingsFormDialog) => (
    <SettingsForm dialog={dialog} />
  );

export const settingsDialog = defineDialog<"settings">({
  title: settingsTitle,
  render: renderSettingsDialog,
});

export const settingsLoadingDialog = defineDialog<"settings-loading">({
  title: settingsTitle,
  render: renderSettingsDialog,
});
