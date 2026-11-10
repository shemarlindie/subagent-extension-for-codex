import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type FieldErrors, useWatch } from "react-hook-form";

import { useController, useSnapshot } from "../../app/state/controller-context";
import type { SettingsPageDialog } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { Notice } from "../../shared/components/notice/notice";
import { SearchField } from "../../shared/components/search/search-field";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { usePersistedDialogForm } from "../../shared/forms/use-persisted-dialog-form";
import { settingsSearch } from "./search/settings-search";
import { SettingsSearchContext } from "./search/settings-search-context";
import { SettingsSearchSummary } from "./search/settings-search-summary";
import { useSettingsSearchView } from "./search/use-settings-search-view";
import { aboutSection } from "./settings-about";
import { SettingsContext } from "./settings-fields";
import {
  activeSection,
  changes,
  differs,
  editCount,
  fieldName,
  rowForm,
  sectionPaths,
  sectionsForm,
  type Values,
} from "./settings-layout";
import {
  loadingSections,
  LoadingSettingsSection,
} from "./settings-loading-section";
import { SettingsLoadingTaskDefaults } from "./settings-loading-task-defaults";
import { SettingsSectionRows } from "./settings-section-rows";
import {
  SettingsSections,
  type SettingsSectionView,
} from "./settings-sections";
import { SettingsTransfer } from "./settings-transfer";
import { useSettingsDiscardPrompt } from "./use-settings-discard-prompt";
import { useSettingsStickyLayout } from "./use-settings-sticky-layout";

export interface SettingsSaveActionState {
  disabled: boolean;
  label: string;
}

interface SettingsFormProps {
  dialog: SettingsPageDialog;
  saveActionPlacement?: "header" | "footer";
  onSaveActionChange?: (state: SettingsSaveActionState) => void;
}

function saveButtonText(busy: boolean, total: number) {
  if (busy) return "Working…";
  if (!total) return "Save";

  return `Save ${total} ${total === 1 ? "change" : "changes"}`;
}

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

  const [selectedSection, setSelectedSection] = useState(
      controller.getLastSettingsSection(),
    ),
    [discarding, setDiscarding] = useState(false),
    [importing, setImporting] = useState(false),
    element = useRef<HTMLFormElement>(null),
    discardPrompt = useRef<HTMLDivElement>(null);

  const { query, setQuery } = useSettingsSearchView(element),
    search = useMemo(() => settingsSearch(query), [query]);

  const isLoading = status === "loading",
    isError = status === "error",
    showDiscard = !loading && discarding && total > 0;

  const saveButtonDisabled = state.busy || !settings || !total,
    saveButtonLabel = saveButtonText(state.busy, total);

  useEffect(() => {
    onSaveActionChange?.({
      disabled: saveButtonDisabled,
      label: saveButtonLabel,
    });
  }, [onSaveActionChange, saveButtonDisabled, saveButtonLabel]);

  useSettingsDiscardPrompt(showDiscard, discardPrompt);
  useSettingsStickyLayout(element);

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

  // Opening settings focuses search once it is enabled, unless focus has moved
  // on from the arrival heading.
  const searchFocused = useRef(false);

  useEffect(() => {
    if (loading || searchFocused.current) return;
    searchFocused.current = true;

    const active = document.activeElement;
    if (active !== document.body && active?.id !== "settings-heading") return;

    element.current
      ?.querySelector<HTMLInputElement>('[type="search"]')
      ?.focus({ preventScroll: true });
  }, [loading]);

  const sectionOf = (path: string) =>
    sections.find((section) => sectionPaths(section).includes(path));

  const selectSection = (section: string) => {
    setSelectedSection(section);
    controller.saveSettingsSection(section);
  };

  // Opens the section holding a setting and focuses its field.
  const reveal = (path: string) => {
    const section = sectionOf(path);
    if (!section) return;

    flushSync(() => {
      setQuery("");
      selectSection(section.id);
    });

    const field = element.current?.querySelector<HTMLInputElement>(
      `#setting-${fieldName(path)}`,
    );

    // Disabled amounts cannot take focus; their switch restores editing.
    if (field?.disabled) {
      field
        .closest(".setting-row")
        ?.querySelector<HTMLElement>('[role="switch"]')
        ?.focus();
    } else {
      field?.focus();
    }

    return field;
  };

  // An invalid field may sit in an inactive tab: reveal it and show why.
  const showInvalid = (errors: FieldErrors<Values>) => {
    const path = sections
      .flatMap(sectionPaths)
      .find((setting) => fieldName(setting) in errors);

    if (path) reveal(path)?.reportValidity();
  };

  const apply = (entries: Values) => {
    for (const [key, value] of Object.entries(entries)) {
      setValue(key, value, { shouldDirty: true });
    }
  };

  const sectionViews: SettingsSectionView[] = settings
    ? sections.map((section, index) => {
        const matches = search.sectionMatches(section),
          paths = sectionPaths(section),
          resets = Object.assign(
            {},
            ...section.rows.map((row) => rowForm(row, settings.defaults)),
          ) as Values;

        return {
          id: section.id,
          title: section.title,
          hidden: matches.length === 0,
          matches: matches.length,
          score: Math.min(...matches.map((match) => match.score)),
          edits: edits[index],
          content: (
            <SettingsContext.Provider
              value={{
                show: reveal,
                sectionOf: (path) => sectionOf(path)?.title,
                current: paths,
                form,
              }}
            >
              <SettingsSectionRows
                section={section}
                search={search}
                control={control}
                register={register}
              />
              {/* Section resets include hidden rows, so keep them out of search. */}
              <Presence show={!search.active && differs(resets, form)}>
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

  // The transfer section has no setting rows, so search matches its title and
  // its own keywords.
  const transfer = {
      id: "transfer",
      title: "Import and export",
      keywords: ["settings", "JSON", "copy", "file"],
    },
    transferMatches = search.matches(
      [transfer.title, ...transfer.keywords].join(" "),
    );

  sectionViews.push({
    id: transfer.id,
    title: transfer.title,
    hidden: !transferMatches,
    matches: transferMatches ? 1 : 0,
    score: 3,
    content: (
      <SettingsTransfer
        ready={!loading}
        edited={total > 0}
        onImportingChange={setImporting}
      />
    ),
  });

  sectionViews.push(aboutSection(search, selectedSection, !loading));

  const activeSectionId = activeSection(selectedSection, sectionViews),
    matchingSections = sectionViews.filter((section) => !section.hidden),
    resultCount = matchingSections.reduce(
      (sum, section) => sum + (section.matches ?? 0),
      0,
    );

  const clearSearch = () => {
    setQuery("");

    element.current
      ?.querySelector<HTMLInputElement>('[type="search"]')
      ?.focus({ preventScroll: true });
  };

  const submit = handleSubmit((submitted) => {
    if (!settings) return;
    const set = changes(sections, submitted, baseline.current);

    return controller.submit(
      async () => {
        if (Object.keys(set).length) {
          await controller.tool("update_settings", { set });
        }
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

  const discard = () => {
    controller.guardDismiss(undefined);
    controller.backFromSettings();
  };

  return (
    <form
      ref={element}
      id="settings-form"
      className="settings-form"
      noValidate
      aria-busy={isLoading || state.busy || undefined}
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
            <Button onClick={discard}>Discard</Button>
          </Notice>
        </Collapsible.Panel>
      </Collapsible.Root>
      <fieldset
        className={`settings-form-body${loading ? " settings-loading-body" : ""}`}
        disabled={importing}
        aria-label="Settings values"
      >
        <SettingsSearchContext.Provider value={search}>
          <div className="settings-search-toolbar">
            <SearchField
              className="settings-search"
              label="Search settings"
              clearLabel="Clear settings search"
              value={query}
              onValueChange={setQuery}
              disabled={loading}
              focusShortcut
            />
          </div>
          {search.active && !loading && (
            <SettingsSearchSummary
              query={query}
              results={resultCount}
              sections={matchingSections.length}
              onClear={clearSearch}
            />
          )}
          <Presence show={!isError}>
            <div
              className={
                isLoading
                  ? "loading-skeleton settings-loading-skeleton"
                  : "settings-sections-layer"
              }
            >
              <SettingsSections
                sections={sectionViews}
                value={activeSectionId ?? ""}
                loading={isLoading}
                searching={search.active}
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
        </SettingsSearchContext.Provider>
      </fieldset>
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
  renderSettingsDialog = (dialog: SettingsPageDialog) => (
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
