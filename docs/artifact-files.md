# Artifact files

The **Artifacts** tab lists a task's artifacts as file cards, each with a short snippet or a thumbnail, Preview and Download. Preview opens a full-height modal that renders the file by format. This page describes how the work is split between the service and the panel, and the known limits.

## How it works

- **Summaries on the service.** `summarizeArtifact` (`src/core/artifact-file.ts`, shared with the panel) derives a file name, format and byte size, and a bounded snippet: the first 8 lines (each cut at 400 characters), the first 5 CSV rows plus a row count, the first 1,200 Markdown characters, or per-file diff stats from one counting pass. `summarizeStoredArtifact` (`src/core/artifact-summary.ts`) adds a thumbnail for raster images and large SVGs. JSON up to 2 MB is parsed once to format minified files and to flag worker reports (`report: true`).
- **Cached in SQLite.** Summaries live in the `artifacts.summary` column as `{ version, summary }`. A summary is built in the background when its artifact is created, and on first listing when a row has no cached summary.
- **Panel-only tools.** `list_user_agent_artifacts` returns summaries without content; `get_user_agent_artifact` returns one artifact with content. Both are user tools (app visibility only), so snippets and thumbnails never enter model context. Agents keep using `get_agent_artifacts`, which is unchanged.
- **Busy bar.** While content loads, and while a newly selected view renders, the modal shows an indeterminate Base UI `Progress` bar along the toolbar's bottom edge. View rendering is deferred (`useDeferredValue`), so the switcher responds at once and the current view stays visible until the new one is ready. The bar moves by transform only, so it animates while a large file renders; with reduced motion it is a still, full-width bar.
- **Content on demand.** Cards render only from summaries. The modal fetches content when it opens; the controller keeps the last 3 loaded artifacts, so a download right after a preview does not fetch again.
- **Downloads** go through the host's `ui/download-file` request in an embedded panel (the button appears only when the host advertises `downloadFile`), and through a browser download in the console and preview.

## Caveats

### Thumbnails (sharp)

Thumbnails are made by [sharp](https://sharp.pixelplumbing.com/) (libvips), which decodes on its own threads, so a large image does not stall other requests.

- **Native binaries.** sharp loads a prebuilt libvips binary for the current platform. The package bundles `node_modules` (`bundleDependencies`), and `prepack` runs `scripts/bundle-sharp-binaries.mjs` to include both macOS architectures. Packages built on macOS support Apple Silicon and Intel Macs. They do not include sharp binaries for other operating systems, so thumbnails may be unavailable there. Both macOS binaries add about 40 MB.
- **A missing binary only drops thumbnails.** sharp is imported on first use. If it cannot load (for example, a package built without the prepack step), the service logs one warning and images list without thumbnails.
- **Local installs.** `npm install` and `npm ci` install sharp's binary for the current machine. `prepack` adds the other macOS architecture to the package.
- **Formats.** PNG, JPEG, GIF (first frame), WebP, AVIF, TIFF and SVG. HEIC and BMP are not in sharp's prebuilt libvips, so they list without a thumbnail, as do corrupt images, sources over 40 MB or 100 million pixels, and images that take more than 10 seconds.
- **JPEG unless transparent.** A thumbnail is a JPEG unless the image has real transparency. Opaque images with an alpha channel, such as most screenshots, still get a JPEG; this is checked on the small thumbnail, not the source.
- **SVG.** An SVG of at most 64 KB is shown as itself, through `<img>`, so its scripts and external resources never load. A larger one is rasterized on the service by librsvg. Artifacts come from your own workers, but rendering a hostile SVG can still be costly; the size and pixel caps and the timeout bound it.

### Summaries

- **Some whole-file work runs on the service.** The diff stat pass, the CSV row count, the byte count, and JSON parsing are linear in file size. They run once per artifact, because summaries are cached.
- **JSON over 2 MB is not parsed.** It gets no **Report** view even when shaped like a worker result. A minified file's snippet is its first 400 characters, unformatted.
- **Cache invalidation is by version.** Each summary cache entry includes `SUMMARY_VERSION`. Increment it whenever the summary format or generation changes.
- **Uncached summaries are built during listing.** If an artifact has no cached summary, the listing call computes one. Concurrent listings can compute the same summary twice; the result is the same.
- **Failures stay on their own card.** A background summary that fails is ignored and rebuilt at the next listing. If building it fails there too (for example, a corrupt stored body), that artifact lists as a placeholder: an `error` snippet with the message, and whatever title and type its body still yields. The other artifacts list normally. A corrupt cached summary is treated as missing and rebuilt. Failures are not cached, so each listing retries, and an artifact that stays unreadable is retried on every listing. Its Preview and Download fail with a read error too.
- **Diff scanning** expects unified or `git diff` output. It trusts hunk line counts, ending a hunk early only at a line that cannot belong to it. Binary file entries count as files with no changes. Quoted paths with escape sequences are not unescaped. Combined (merge) diffs with `@@@` headers are not supported.
- **CSV and TSV.** The delimiter comes from the MIME type or extension, not from the content. Parsing and counting assume RFC 4180 quoting, so a stray quote inside an unquoted field can merge rows.
- **Format detection** uses the MIME type, then the artifact type, then the title's extension. A mislabelled artifact renders as plain text.
- **File names** come from the title (`Repository diff · attempt 1` becomes `repository-diff-attempt-1.diff`), with the extension derived from its MIME type or artifact type. Artifacts with the same title and derived extension can produce identical download names. A title with no Latin letters or digits falls back to the artifact type.
- **Stored content.** Raster images are base64 in `content`, and everything else is text. The service creates JSON reports and diffs; workers do not produce image artifacts.

### Transfer

- `get_user_agent_artifact` returns the whole artifact in one tool result, with no streaming or ranges. Very large artifacts cross the MCP bridge as one JSON message, and base64 images are about a third larger than the file. Host message size limits have not been verified.
- The summary and content tools follow the other user tools. Over HTTP, `/api/tools/...` accepts them only with a console session, and `/api/user-tools/...` treats every call as a user call. Over MCP, the host is trusted to enforce app-only visibility.

### Rendering in the panel

The modal does full-file work in the browser for the open file:

- **Diffs** are parsed whole with `parse-diff`, and the Changes view has no line cap. With more than 8 files, sections start collapsed; rows mount on expansion and unmount on collapse. An indeterminate progress bar shows while an expanded section renders. A large expanded diff still builds a large DOM. Each diff line is highlighted on its own, so constructs that span lines, such as block comments, can be colored wrongly.
- **Source** shows the first 5,000 lines and counts the rest. Highlighting is synchronous and is skipped above 200,000 characters.
- **Tables** parse and show the first 5,000 rows, using the service's count for the rest.
- **Markdown** and the **Report** view render the whole document, with no cap.
- **Minified JSON** is pretty-printed in full for the Source view.
- **Images** open from the full data URL, so the browser decodes the original image.
- The modal always takes the full available height, so short files leave empty space below them.
- **Copy** appears only outside an embedded frame, where the clipboard is available. Markdown links open with `target="_blank"`, which a sandboxed host frame may block; they are not routed through the host's open-link request.

### Fixtures

- **In the panel dev host**, the artifact tools are served by the real service code on the Vite server (`ui/dev/fixture-service.ts`): a `Store` in a temporary SQLite file seeded with the fixtures, called through `callTool` with user authority. Summaries, sharp thumbnails and the summary cache behave as in production. It skips the MCP transport and the service process itself; live mode and the tests cover those. The Bridge log's `served` field shows where each call ran.
- The **Profile the production build** fixture generates about 7 MB of content on the Vite server the first time that task's artifacts are requested, and writes them to the fixture store. Other tasks' artifact requests do not generate it.
