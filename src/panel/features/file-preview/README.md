# File previews

Viewers for one file, used by the Changes tab's diffs and its **Preview** modal.

## Ownership

The feature root owns format detection, viewer selection and shared controls.
`code/`, `markdown/`, `diff/` and `table/` own their respective viewers and
format-specific rendering. Keep viewer helpers and focused tests with their
owning format; keep feature styling in `file-preview.css`.

## Formats

`file-format.ts` detects a format from the MIME type, then the extension, and lists the views each offers, best first:

| Format                   | Views                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Diff (`.diff`, `.patch`) | Changes, Source                                                    |
| Markdown                 | Preview, Source                                                    |
| CSV and TSV              | Table, Source                                                      |
| Images                   | Image; an SVG adds Source, and one over 64 KB shows as source only |
| JSON, code and text      | Source (minified JSON is pretty-printed)                           |

`FilePreview` takes a loaded file and shows the switcher, the file's size and an optional Copy button. Callers own loading and errors: the Changes tab's `ChangedFilePreview` shows `Progress` while a file loads and the error in place of the body. Images arrive as base64.

## Large content

Nothing is truncated. Long content stays light in the DOM instead:

- **Blocks.** `CodeView`, `TableView` and each diff file split their rows into blocks of 200. A block mounts only near the visible part of its scroll area (`LazyBlock` in `src/panel/shared/components/lazy-block/lazy-block.tsx`, using an `IntersectionObserver`) and otherwise is an empty box of its last measured height, so the scroll position holds. The scroll area is found again when the window or the scroll area itself resizes, since which box scrolls depends on the panel's size and the task header's height. A view's first block renders at once. Tables use one `<tbody>` per block.
- **Collapsed diff files** unmount their rows, and an expanding file shows `Progress` while it renders.
- **Highlighting** is synchronous and is skipped above 200,000 characters. Diff lines are highlighted one at a time, so constructs that span lines, such as block comments, can be colored wrongly.
- **Not virtualized:** Markdown previews and single long lines (a minified file is one row).
- **Transfer.** The service pages large diffs by whole files and large files by characters (`next_cursor`, at most 1,000,000 characters per page); the panel reads every page before rendering.
