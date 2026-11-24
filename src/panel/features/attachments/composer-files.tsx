import {
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";

import { useController } from "../../app/state/controller-context";
import { useSessionState } from "../../app/state/session/use-session-state";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { fileLimit, loadFile, type ComposerFile } from "./composer-file";

let nextId = 0;
const empty: ComposerFile[] = [];

/** Reserves slots before reading so concurrent drops keep their order and limits. */
export function useComposerFiles(
  scope: "task" | "newTask",
  id: string,
  disabled: boolean,
) {
  const { session } = useController();

  const [files, update] = useSessionState(
    scope,
    id,
    (state) => state.files ?? empty,
  );

  const [errors] = useSessionState(scope, id, (state) => state.fileErrors);
  const current = () => session.get(scope, id).files ?? empty;

  async function read(file: File, entry: ComposerFile) {
    try {
      const upload = await loadFile(file, entry.name);

      if (current().includes(entry)) {
        update({
          files: current().map((item) =>
            item === entry ? { ...entry, upload } : item,
          ),
        });
      }
    } catch (error) {
      if (!current().includes(entry)) return;

      update({
        files: current().filter((item) => item !== entry),
        fileErrors: [
          ...(session.get(scope, id).fileErrors ?? []),
          `${entry.name}: ${error instanceof Error ? error.message : "Could not read file."}`,
        ],
      });
    }
  }

  function intake(selected: File[]) {
    if (disabled) return;
    const errors: string[] = [];

    for (const file of selected) {
      const name = file.name || `Clipboard.${file.type.split("/")[1] || "txt"}`;
      const prior = current();
      const problem = fileLimit(file, prior);

      if (problem) {
        errors.push(`${name}: ${problem}`);
        continue;
      }

      const entry = { id: ++nextId, name, size: file.size };
      update({ files: [...prior, entry] });
      void read(file, entry);
    }

    update({ fileErrors: errors });
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    intake(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  const input = useRef<HTMLInputElement>(null);

  return {
    files,
    pending: files.some((item) => !item.upload),
    handlers: {
      onDragOver(event: DragEvent) {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      },
      onDrop(event: DragEvent) {
        if (
          !event.dataTransfer.types.includes("Files") &&
          !event.dataTransfer.files.length
        ) {
          return;
        }

        event.preventDefault();
        intake(Array.from(event.dataTransfer.files));
      },
      onPaste(event: ClipboardEvent) {
        const { files, items } = event.clipboardData;

        const pasted = files.length
          ? Array.from(files)
          : Array.from(items).flatMap((item) => item.getAsFile() ?? []);

        if (!pasted.length) return;
        event.preventDefault();
        intake(pasted);
      },
    },
    button: (
      <>
        <input hidden type="file" multiple ref={input} onChange={choose} />
        <Button
          variant="ghost"
          className="chat-icon-button"
          aria-label="Attach files"
          title="Attach files"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Icon name="plus" size={14} />
        </Button>
      </>
    ),
    chips: (files.length > 0 || Boolean(errors?.length)) && (
      <div className="composer-files">
        {files.map((item) => (
          <button
            type="button"
            className="attachment-chip"
            key={item.id}
            title={item.name}
            aria-label={`Remove ${item.name}`}
            disabled={disabled}
            onClick={() =>
              update({ files: current().filter((file) => file.id !== item.id) })
            }
          >
            <span>{item.name}</span> ×
          </button>
        ))}
        {errors?.length ? (
          <div role="alert" className="form-error">
            {errors.join(" ")}
          </div>
        ) : null}
      </div>
    ),
  };
}
