import { useCallback, useEffect, useState } from "react";

import { PAGES } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { BackButton } from "../../shared/components/navigation/back-button";
import { PageFrame } from "../../shared/components/navigation/page-frame";
import {
  SettingsForm,
  type SettingsFormDialog,
  type SettingsSaveActionState,
} from "./settings-form";

function isSettingsDialog(dialog?: DialogState): dialog is SettingsFormDialog {
  return dialog?.kind === "settings" || dialog?.kind === "settings-loading";
}

export function SettingsPage() {
  const controller = useController(),
    state = useSnapshot(),
    [saveAction, setSaveAction] = useState<SettingsSaveActionState>({
      disabled: true,
      label: "Save",
    });

  const updateSaveAction = useCallback((next: SettingsSaveActionState) => {
    setSaveAction((current) =>
      current.disabled === next.disabled && current.label === next.label
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    controller.ensureSettingsLoaded();
  }, [controller, state.connected, state.dialog, state.page]);

  const dialog = isSettingsDialog(state.dialog)
    ? state.dialog
    : {
        kind: "settings-loading" as const,
        scope: state.scopeVersion,
        request: 0,
        status: "loading" as const,
      };

  return (
    <PageFrame
      className="settings-page"
      title={PAGES.settings.label}
      headingId="settings-heading"
      back={
        <BackButton
          label={PAGES.tasks.label}
          disabled={state.busy}
          onClick={() => controller.backFromSettings()}
        />
      }
      actions={
        <Button
          id="submit"
          type="submit"
          form="settings-form"
          variant="primary"
          disabled={saveAction.disabled}
        >
          {saveAction.label}
        </Button>
      }
    >
      <SettingsForm
        dialog={dialog}
        saveActionPlacement="header"
        onSaveActionChange={updateSaveAction}
      />
    </PageFrame>
  );
}
