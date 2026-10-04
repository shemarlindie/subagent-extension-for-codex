import { Accordion } from "@base-ui/react/accordion";
import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type FieldErrors, useForm, useWatch } from "react-hook-form";

import { Button } from "../components/button";
import { Chevron } from "../components/chevron";
import { useController } from "../components/controller-context";
import { Presence } from "../components/motion";
import { reducedMotion } from "../components/motion-utils";
import { Notice } from "../components/notice";
import type { DialogState } from "../core/types";
import { defineDialog } from "./dialog-definition";
import { FormFooter } from "./form-footer";
import { Help, SettingRowView, SettingsContext } from "./settings-fields";
import {
  changes,
  differs,
  editCount,
  openSections,
  rowForm,
  sectionKeys,
  sectionsForm,
  summary,
  type Values,
} from "./settings-layout";
import { ModelTable } from "./settings-model-table";

/** The settings editor: one accordion section per server-described section. */
interface SettingsFormProps {
  dialog: Extract<DialogState, { kind: "settings" }>;
}

export function SettingsForm({ dialog }: SettingsFormProps) {
  const controller = useController(),
    { sections, values: saved, defaults } = dialog.settings,
    initial = sectionsForm(sections, saved);

  const { control, register, handleSubmit, setValue } = useForm<Values>({
    defaultValues: initial,
  });

  const form = { ...initial, ...useWatch({ control }) } as Values,
    edits = sections.map((section) => editCount(section, form, initial)),
    total = edits.reduce((sum, count) => sum + count, 0);

  const [open, setOpen] = useState(sections.slice(0, 1).map((s) => s.id)),
    [discarding, setDiscarding] = useState(false),
    element = useRef<HTMLFormElement>(null),
    discardPrompt = useRef<HTMLDivElement>(null);

  const showDiscard = discarding && total > 0;

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
        block: "end",
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

  // Closing with unsaved edits asks first; saving closes without asking.
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

  // Opens the section holding a setting and focuses its field, which also
  // scrolls it into view.
  const reveal = (key: string) => {
    const section = sectionOf(key);
    if (!section) return;
    flushSync(() => setOpen([section.id]));

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

  // An invalid field may sit in a closed section: reveal it and show why.
  const showInvalid = (errors: FieldErrors<Values>) => {
    const key = sections.flatMap(sectionKeys).find((name) => name in errors);

    if (key) reveal(key)?.reportValidity();
  };

  const apply = (entries: Values) => {
    for (const [key, value] of Object.entries(entries))
      setValue(key, value, { shouldDirty: true });
  };

  return (
    <form
      ref={element}
      className="settings-form"
      noValidate
      onSubmit={handleSubmit((submitted) => {
        const set = changes(sections, submitted, initial);

        return controller.submit(async () => {
          if (Object.keys(set).length)
            await controller.tool("update_agent_settings", { set });
        });
      }, showInvalid)}
    >
      <p className="form-note">Defaults for new tasks.</p>
      {/* One section opens at a time; the first starts open. Closed sections
          stay mounted so their fields are still validated. */}
      <Accordion.Root
        className="settings-groups"
        keepMounted
        value={openSections(open, sections)}
        onValueChange={(value) => setOpen(value as string[])}
      >
        {sections.map((section, index) => {
          const keys = sectionKeys(section),
            resets = Object.assign(
              {},
              ...section.rows.map((row) => rowForm(row, defaults)),
            ) as Values;

          return (
            <Accordion.Item
              key={section.id}
              value={section.id}
              className="settings-group"
            >
              <Accordion.Header className="settings-group-header">
                <Accordion.Trigger className="settings-group-trigger">
                  <Chevron square />
                  <span className="settings-group-title">{section.title}</span>
                  <span className="settings-group-summary">
                    {section.rows
                      .flatMap((row) => summary(row, form))
                      .join(" · ")}
                  </span>
                  {edits[index] > 0 && (
                    <span className="settings-group-badge">
                      {edits[index]} changed
                    </span>
                  )}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="collapse-panel settings-group-panel">
                {/* Links in a section's help point only to other sections. */}
                <SettingsContext.Provider
                  value={{
                    show: reveal,
                    sectionOf: (key) => sectionOf(key)?.title,
                    current: keys,
                    form,
                  }}
                >
                  <div className="settings-group-content">
                    <div className="settings-section-intro">
                      <Help
                        id={`settings-${section.id}-help`}
                        parts={section.help}
                      />
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
                  </div>
                </SettingsContext.Provider>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion.Root>
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
                controller.dismiss();
              }}
            >
              Discard
            </Button>
          </Notice>
        </Collapsible.Panel>
      </Collapsible.Root>
      <FormFooter
        label={
          total
            ? `Save ${total} ${total === 1 ? "change" : "changes"}`
            : "Save settings"
        }
        disabled={!total}
      />
    </form>
  );
}

export const settingsDialog = defineDialog<"settings">({
  title: () => "Plugin settings",
  render: (dialog) => <SettingsForm dialog={dialog} />,
});
