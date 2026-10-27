import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { errorMessage } from "../../shared/utils/error-message";
import { writeClipboardText } from "../../shared/utils/write-clipboard";

type SettingsExport = { document: string };

type SettingsImport = { ignored: string[] };

type SettingsTransferForm = { document: string };

type TransferStatus =
  | { kind: "idle" }
  | { kind: "copied" }
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

/** Copies saved settings as JSON, and imports a copy pasted from elsewhere. */
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
    [copyError, setCopyError] = useState(""),
    [copying, setCopying] = useState(false),
    disabled = !ready || edited || busy || copying;

  async function copy() {
    setCopyError("");
    setStatus({ kind: "idle" });
    setCopying(true);

    try {
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
      setCopyError(errorMessage(error));
    } finally {
      setCopying(false);
    }
  }

  function importPasted() {
    let ignored: string[] = [];
    // Import replaces the form, so edits must wait until it reloads.
    onImportingChange(true);

    void controller
      .submit(
        async () => {
          setCopyError("");
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
        Copy your settings as JSON. Save your changes first.
      </p>
      <div className="settings-transfer-actions">
        <Button disabled={disabled} onClick={() => void copy()}>
          {copying ? "Copying…" : "Copy JSON"}
        </Button>
        <span role="status">
          {status.kind === "copied" ? "Copied" : null}
          {status.kind === "imported"
            ? `Imported${status.ignored.length ? `. Skipped: ${status.ignored.join(", ")}` : ""}`
            : null}
        </span>
      </div>
      {copyError ? (
        <p className="form-error" role="alert">
          {copyError}
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
