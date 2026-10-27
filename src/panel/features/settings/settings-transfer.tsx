import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { errorMessage } from "../../shared/utils/error-message";
import { writeClipboardText } from "../../shared/utils/write-clipboard";

type SettingsExport = { document: string };

type SettingsImport = { ignored: string[] };

type ExportAction = "copy" | "save";

type SettingsTransferForm = { document: string };

type TransferStatus =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "saved"; path: string }
  // The host blocked the clipboard, so the export is shown for manual copy.
  | { kind: "manual"; document: string }
  | { kind: "imported"; ignored: string[] };

type SettingsTransferProps = {
  ready: boolean;
  // Copy reads saved values and import reloads the form, so either would
  // ignore or drop unsaved edits.
  edited: boolean;
  onImportingChange: (importing: boolean) => void;
};

/** Saves or copies settings as JSON, and imports a copy pasted from elsewhere. */
export function SettingsTransfer({
  ready,
  edited,
  onImportingChange,
}: SettingsTransferProps) {
  const { control, register, reset } = useForm<SettingsTransferForm>({
    defaultValues: { document: "" },
  });

  const pasted = useWatch({ control, name: "document", defaultValue: "" });

  const controller = useController(),
    { busy } = useSnapshot(),
    pasteId = useId(),
    [status, setStatus] = useState<TransferStatus>({ kind: "idle" }),
    [exportError, setExportError] = useState(""),
    [exporting, setExporting] = useState<ExportAction>(),
    disabled = !ready || edited || busy || Boolean(exporting);

  async function exportSaved(action: ExportAction) {
    setExportError("");
    setStatus({ kind: "idle" });
    setExporting(action);

    try {
      if (action === "save") {
        const { path } = await controller.tool<{ path: string }>(
          "app_save_settings_file",
        );

        setStatus({ kind: "saved", path });

        return;
      }

      const { document } = await controller.tool<SettingsExport>(
        "app_export_settings",
      );

      try {
        await writeClipboardText(document);
        setStatus({ kind: "copied" });
      } catch {
        setStatus({ kind: "manual", document });
      }
    } catch (error) {
      setExportError(
        action === "save"
          ? `Couldn't save settings. ${errorMessage(error)} Use Copy JSON instead.`
          : errorMessage(error),
      );
    } finally {
      setExporting(undefined);
    }
  }

  function importPasted() {
    let ignored: string[] = [];
    // Import replaces the form, so edits must wait until it reloads.
    onImportingChange(true);

    void controller
      .submit(
        async () => {
          setExportError("");
          setStatus({ kind: "idle" });

          ({ ignored } = await controller.tool<SettingsImport>(
            "app_import_settings",
            { document: pasted },
          ));
        },
        false,
        () => {
          reset({ document: "" });
          setStatus({ kind: "imported", ignored });
        },
      )
      .finally(() => onImportingChange(false));
  }

  return (
    <div className="settings-transfer">
      <p className="settings-transfer-note">
        Save or copy your settings as JSON. Save your changes first.
      </p>
      <p className="settings-transfer-note">
        Exported files are saved to Downloads.
      </p>
      <div className="settings-transfer-actions">
        <Button disabled={disabled} onClick={() => void exportSaved("save")}>
          {exporting === "save" ? "Saving…" : "Export file"}
        </Button>
        <Button disabled={disabled} onClick={() => void exportSaved("copy")}>
          {exporting === "copy" ? "Copying…" : "Copy JSON"}
        </Button>
      </div>
      <div className="settings-transfer-status">
        <span role="status">
          {status.kind === "copied" ? "Copied" : null}
          {status.kind === "saved" ? (
            <>
              Saved to <code>{status.path}</code>
            </>
          ) : null}
          {status.kind === "imported"
            ? `Imported${status.ignored.length ? `. Skipped: ${status.ignored.join(", ")}` : ""}`
            : null}
        </span>
      </div>
      {exportError ? (
        <p className="form-error" role="alert">
          {exportError}
        </p>
      ) : null}
      {status.kind === "manual" ? (
        <label className="settings-transfer-field">
          Couldn't copy automatically. Select and copy these settings.
          <textarea
            readOnly
            rows={6}
            value={status.document}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}
      <label className="settings-transfer-field" htmlFor={pasteId}>
        Paste copied settings
      </label>
      <textarea
        id={pasteId}
        rows={4}
        disabled={busy}
        spellCheck={false}
        {...register("document")}
      />
      <div className="settings-transfer-actions">
        <Button disabled={disabled || !pasted.trim()} onClick={importPasted}>
          Import settings
        </Button>
      </div>
    </div>
  );
}
