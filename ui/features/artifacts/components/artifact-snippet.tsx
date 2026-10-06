import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ArtifactSummary } from "../../../shared/state/types";
import { CodeView } from "../../file-preview/components/code-view";
import { DiffStat } from "../../file-preview/components/diff-stat";
import { TableView } from "../../file-preview/components/table-view";
import { SNIPPET_FILES } from "../artifact-file";

type ArtifactSnippetProps = {
  summary: ArtifactSummary;
};

/** Renders the bounded snippet carried by an artifact summary. */
export function ArtifactSnippet({ summary }: ArtifactSnippetProps) {
  const snippet = summary.snippet;

  switch (snippet.kind) {
    case "image":
      return (
        <div className="snippet-image">
          <img src={snippet.src} alt="" />
        </div>
      );

    case "diff": {
      const more = snippet.total_files - snippet.files.length;

      return (
        <ul className="snippet-files">
          {snippet.files.slice(0, SNIPPET_FILES).map((file, index) => (
            <li key={index}>
              <span className="diff-path">
                {file.from ? `${file.from} → ${file.path}` : file.path}
              </span>
              {file.status !== "modified" && (
                <span className="diff-tag">{file.status}</span>
              )}
              <DiffStat additions={file.additions} deletions={file.deletions} />
            </li>
          ))}
          {more > 0 && (
            <li className="help">
              {more} more {more === 1 ? "file" : "files"}
            </li>
          )}
        </ul>
      );
    }

    case "markdown":
      return (
        <div className="markdown-body">
          <Markdown
            remarkPlugins={[remarkGfm]}
            // The snippet opens the preview, so links inside it stay plain text.
            components={{ a: ({ children }) => <span>{children}</span> }}
          >
            {snippet.text}
          </Markdown>
        </div>
      );
    case "table":
      return <TableView rows={snippet.rows} />;
    case "lines":
      return <CodeView code={snippet.text} language={snippet.language} />;
    case "none":
      return null;
    case "error":
      return <p className="snippet-error error">{snippet.message}</p>;
  }
}
