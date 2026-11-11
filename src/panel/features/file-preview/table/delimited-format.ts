/** Parses CSV or TSV, honoring quoted fields with embedded separators and newlines. */
export function parseDelimited(content: string, separator = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A byte order mark would otherwise prefix the first header.
  for (
    let index = content.startsWith("\uFEFF") ? 1 : 0;
    index < content.length;
    index++
  ) {
    const char = content[index];

    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
