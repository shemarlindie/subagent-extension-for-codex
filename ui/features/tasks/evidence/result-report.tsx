import { MarkdownView } from "../../file-preview/components/markdown-view";

type ResultReportProps = { reply?: string };

export function ResultReport({ reply }: ResultReportProps) {
  return reply !== undefined ? (
    <div className="report">
      <MarkdownView content={reply} />
    </div>
  ) : (
    <p className="help">
      The worker’s reply appears here when its turn finishes.
    </p>
  );
}
