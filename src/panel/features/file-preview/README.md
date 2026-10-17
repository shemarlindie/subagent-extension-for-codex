# File previews

Use this guide when changing file viewers or shared Markdown rendering.
The feature provides viewers for the Changes tab's diffs and its **Preview** modal.
Chat and Activity also render messages with its [Markdown view](#markdown).

## Ownership

The feature root owns format detection, viewer selection and shared controls.
`code/`, `markdown/`, `diff/` and `table/` own their respective viewers, parsers and
format-specific rendering. Keep viewer helpers and focused tests with their
owning format. Keep feature styling in `file-preview.css`.

## Formats

`file-format.ts` detects a format from the MIME type, then the extension, and lists the views each offers, best first:

| Format                   | Views                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| Diff (`.diff`, `.patch`) | Changes and Source for a parsed diff, otherwise Source              |
| Markdown                 | Preview, Source                                                     |
| CSV and TSV              | Table, Source                                                       |
| Images                   | Image. An SVG adds Source, and one over 64 KiB shows as source only |
| JSON, code and text      | Source (minified JSON is pretty-printed)                            |

`FilePreview` renders loaded content. Its caller owns reads, errors and file
navigation. Changes supplies a file's parsed diff as an additional **Diff** view
and owns the selected view and line-wrapping choice across files. Keep these
workflow decisions outside the reusable viewers. Raster image content is base64.
SVG content is markup.

## Markdown

`MarkdownView` renders GitHub-flavored Markdown with `react-markdown` and
`remark-gfm` for Chat, Activity and Markdown previews:

- **HTML.** Embedded HTML always shows as literal text, in messages and
  Markdown previews alike, so prose such as `Promise<Result>` stays visible.
- **Links.** `http`, `https` and `mailto` links open outside the panel. Embedded
  hosts open them through the host bridge. `#` links to footnotes and headings
  scroll within the same view. Headings and footnotes use
  unique ids so each link resolves within its own message. Other targets,
  such as relative file paths, cannot resolve from the panel. They appear as
  dotted text with the target in a tooltip.
- **Images.** Only web and `data:image/` sources load. A relative path or an
  image that fails to load shows its alt text.
- **Code.** Fenced blocks highlight with the languages registered in
  `highlight.ts`. Unknown languages render as plain code.

## Large content

The service pages transfers, and the panel reads all pages before rendering.
Paging does not limit the number of rows the viewer can render.

Source, table and diff viewers defer offscreen row blocks through `LazyBlock`,
retaining measured height to preserve reading position. Keep each block attached to the active scroll container as the layout changes. Collapsed diff files unmount their rows and show
progress when expanding.

Syntax highlighting is synchronous and falls back to plain text for oversized
inputs. Source views highlight the whole source. Diffs highlight individual
lines, so multiline syntax can be colored incorrectly. Markdown previews and
single long lines do not use deferred row blocks. Include them when checking
large-content performance.
