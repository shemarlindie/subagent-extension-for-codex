import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import type { StagedFile } from "../../../shared/attachments/model";
import { useController } from "../../app/state/controller-context";
import { useSessionState } from "../../app/state/session/use-session-state";
import {
  draftPreview,
  fileLimit,
  loadFile,
  type DraftFile,
} from "./draft-file";

let nextId = 0;
const empty: DraftFile[] = [];

const carriesFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/**
 * A composer's draft files, kept in session memory. Slots are reserved
 * before reading, so concurrent drops keep their order and limits.
 */
export function useDraftFiles(
  scope: "task" | "newTask" | "delegate",
  id: string,
  disabled: boolean,
) {
  const controller = useController();
  const { session } = controller;

  const [files, update] = useSessionState(
    scope,
    id,
    (state) => state.files ?? empty,
  );

  const [errors] = useSessionState(scope, id, (state) => state.fileErrors);
  const current = () => session.get(scope, id).files ?? empty;

  // Drag events fire for each child the pointer crosses, so count them.
  const depth = useRef(0);
  const [dropping, setDropping] = useState(false);

  async function read(file: File, entry: DraftFile) {
    try {
      const loaded = await loadFile(file, entry.name);

      if (current().includes(entry)) {
        update({
          files: current().map((item) =>
            item === entry ? { ...entry, ...loaded } : item,
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

  /**
   * Opens a file in the host's viewer through a staged copy, which the send
   * then reuses. Other hosts get the panel's preview.
   */
  async function open({ id: fileId, upload, mime }: DraftFile) {
    if (!upload) return;
    const { transport } = controller;

    if (!controller.getSnapshot().host.canOpenFiles || !transport.openFile) {
      controller.open({
        kind: "draft-attachment",
        file: draftPreview(upload, mime),
      });

      return;
    }

    const staged = await controller.tool<StagedFile>("app_stage_file", {
      name: upload.name,
      data: upload.data,
    });

    update({
      files: current().map((item) =>
        item.id === fileId ? { ...item, staged: staged.id } : item,
      ),
    });

    await transport.openFile(staged.path);
  }

  function add(selected: File[]) {
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

    update({ fileErrors: errors.length ? errors : undefined });
  }

  return {
    files,
    errors,
    pending: files.some((item) => !item.upload),
    add,
    open: (file: DraftFile) => controller.run(() => open(file)),
    remove: (fileId: number) =>
      update({
        files: current().filter((file) => file.id !== fileId),
        fileErrors: undefined,
      }),
    dismissErrors: () => update({ fileErrors: undefined }),
    /** Spread on the composer box, which takes drops and pastes. */
    dropTarget: {
      "data-dropping": dropping || undefined,
      onDragEnter(event: DragEvent) {
        if (disabled || !carriesFiles(event)) return;
        depth.current++;
        setDropping(true);
      },
      onDragLeave(event: DragEvent) {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDropping(false);
      },
      // Taking every file drag keeps the browser from opening the file.
      onDragOver(event: DragEvent) {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (disabled) event.dataTransfer.dropEffect = "none";
      },
      onDrop(event: DragEvent) {
        depth.current = 0;
        setDropping(false);
        if (!carriesFiles(event) && !event.dataTransfer.files.length) return;
        event.preventDefault();
        add(Array.from(event.dataTransfer.files));
      },
      // Copied text wins, since rich content such as a spreadsheet range
      // often carries an image of itself too.
      onPaste(event: ClipboardEvent) {
        const { files, items, types } = event.clipboardData;
        if (types.includes("text/plain")) return;

        const pasted = files.length
          ? Array.from(files)
          : Array.from(items).flatMap((item) => item.getAsFile() ?? []);

        if (!pasted.length) return;
        event.preventDefault();
        add(pasted);
      },
    },
  };
}

export type DraftFiles = ReturnType<typeof useDraftFiles>;
