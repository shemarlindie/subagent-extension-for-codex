import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, language] of Object.entries({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  makefile,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}))
  hljs.registerLanguage(name, language);

// Highlighting is synchronous; past this size the text renders plain so the panel stays responsive.
const MAX_HIGHLIGHT_CHARS = 200_000;

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Escaped HTML for the code, split into lines. Spans that cross a line break are
 * closed and reopened, so each line can sit in its own row beside a line number.
 */
export function highlightLines(code: string, language?: string): string[] {
  const html =
    language && hljs.getLanguage(language) && code.length <= MAX_HIGHLIGHT_CHARS
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : escapeHtml(code);

  const lines: string[] = [];
  const open: string[] = [];

  for (const line of html.split("\n")) {
    const prefix = open.join("");

    for (const tag of line.matchAll(/<span[^>]*>|<\/span>/g))
      if (tag[0] === "</span>") open.pop();
      else open.push(tag[0]);

    lines.push(prefix + line + "</span>".repeat(open.length));
  }

  return lines;
}

/** Highlights one line, such as a diff row, without the surrounding file. */
export function highlightLine(code: string, language?: string) {
  return highlightLines(code, language)[0] ?? "";
}
