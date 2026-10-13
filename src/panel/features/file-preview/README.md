# File previews

Use this guide when changing file viewers or shared Markdown rendering.
The feature renders one file at a time for the Changes tab's diffs and its **Preview** modal.
Chat and Activity also render messages with its [Markdown view](#markdown).

## Ownership

The feature root owns format detection, viewer selection and shared controls.
`code/`, `markdown/`, `diff/` and `table/` own their respective viewers and
format-specific rendering. Keep viewer helpers and focused tests with their
owning format; keep feature styling in `file-preview.css`.

## Formats

`file-format.ts` detects a format from the MIME type, then the extension, and lists the views each offers, best first:

| Format                   | Views                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| Diff (`.diff`, `.patch`) | Changes, Source when a diff can be parsed; Source otherwise         |
| Markdown                 | Preview, Source                                                     |
| CSV and TSV              | Table, Source                                                       |
| Images                   | Image; an SVG adds Source, and one over 64 KiB shows as source only |
| JSON, code and text      | Source (minified JSON is pretty-printed)                            |

`FilePreview` takes a loaded file and shows the switcher in its toolbar by default. A caller can pass `viewSwitcherTarget` to place it elsewhere, as the Changes preview does in the dialog title row. It also shows the file's size and an optional Copy button. Given the file's own parsed diff, it adds a **Diff** view after the format's views; the Changes tab's preview passes the file's part of the task's loaded changes. Callers own loading and errors: the Changes tab's `ChangedFilePreview` shows the error in place of the body. When it moves to another changed file, it keeps the last file showing with its own `progress` until the next is read, and keeps the chosen `view` across files. It sets `alwaysShowViews` so a single-view file still shows its switcher, and lays the toolbar out by width alone, so stepping between files never changes its height. Raster images arrive as base64; SVG content is markup.

Tables keep every cell of a row wider than the header and drop a leading byte
order mark. Diffs show Git's `\ No newline at end of file` as a note between
lines and ignore CRLF line endings.

Source and diff lines scroll horizontally by default. `FilePreview` accepts
`wrapLines={true}` to wrap those viewers instead. The Changes preview owns this
choice across files and renders `FilePreviewOptions` in the dialog heading
after navigation; deleted-file diffs use the same wrapping styles. Markdown,
table and image previews retain their format-specific layout.

## Markdown

`MarkdownView` renders GitHub-flavored Markdown with `react-markdown` and
`remark-gfm` for Chat, Activity and Markdown previews:

- **HTML.** Embedded HTML always shows as literal text, in messages and
  Markdown previews alike, so prose such as `Promise<Result>` stays visible.
- **Links.** `http`, `https` and `mailto` links open outside the panel; embedded
  hosts open them through the host bridge. `#` links to footnotes and headings
  scroll within the same view; headings get GitHub-style ids from
  `rehype-slug`, prefixed so each view's ids are unique. Other targets,
  such as relative file paths, have nowhere to go from the panel and show as
  dotted text with the target as a tooltip.
- **Images.** Only web and `data:image/` sources load. A relative path or an
  image that fails to load shows its alt text.
- **Code.** Fenced blocks highlight with the languages registered in
  `highlight.ts`, including highlight.js aliases such as `c++`, `tsx` and
  `console`. Unknown languages render as plain code.

## Large content

The viewers render all content supplied to them. Large transfers are paged by
the service; paging does not limit the final number of rendered rows. Long
content stays light in the DOM through deferred row blocks:

- **Blocks.** `CodeView`, `TableView` and each diff file split their rows into blocks of 200. A block mounts only near the visible part of its scroll area (`LazyBlock` in `src/panel/shared/components/lazy-block/lazy-block.tsx`, using an `IntersectionObserver`) and otherwise is an empty box of its last measured height, so the scroll position holds. The scroll area is found again when the window or the scroll area itself resizes, since which box scrolls depends on the panel's size and the task header's height. A view's first block renders at once. Tables use one `<tbody>` per block.
- **Collapsed diff files** unmount their rows, and an expanding file shows `Progress` while it renders.
- **Highlighting** is synchronous and is skipped when an individual highlighting
  call exceeds 200,000 characters. Source views highlight the whole source;
  diffs highlight each line, so constructs spanning lines, such as block
  comments, can be colored wrongly.
- **Not virtualized:** Markdown previews and single long lines (a minified file is one row).
- **Transfer.** The service pages large diffs by whole files and large files by characters (`next_cursor`, at most 1,000,000 characters per page); the panel reads every page before rendering.
