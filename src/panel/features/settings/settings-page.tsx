import { useCallback, useEffect, useState } from "react";

import { isSettingsPageDialog, PAGES } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import type { SettingsPageDialog } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { BackButton } from "../../shared/components/navigation/back-button";
import { PageFrame } from "../../shared/components/navigation/page-frame";
import { SettingsForm, type SettingsSaveActionState } from "./settings-form";

export function SettingsPage() {
  const controller = useController();

  const { connected, dialog, page, scopeVersion, busy } = useSnapshot([
    "connected",
    "dialog",
    "page",
    "scopeVersion",
    "busy",
  ]);

  const [saveAction, setSaveAction] = useState<SettingsSaveActionState>({
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
  }, [controller, connected, dialog, page]);

  const pageDialog: SettingsPageDialog = isSettingsPageDialog(dialog)
    ? dialog
    : {
        kind: "settings-loading",
        scope: scopeVersion,
        request: 0,
        status: "loading",
      };

  return (
    <PageFrame
      className="settings-page"
      title={PAGES.settings.label}
      headingId="settings-heading"
      titleStatus={
        pageDialog.kind === "settings-loading" &&
        pageDialog.status === "loading" ? (
          <span
            className="settings-title-status"
            role="status"
            aria-label="Loading settings"
          >
            <LoadingSpinner />
          </span>
        ) : undefined
      }
      back={
        <BackButton
          label={PAGES.tasks.label}
          disabled={busy}
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
        dialog={pageDialog}
        saveActionPlacement="header"
        onSaveActionChange={updateSaveAction}
      />
    </PageFrame>
  );
}
