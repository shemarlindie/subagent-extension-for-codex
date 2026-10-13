export type StartupOutputField = { label: string; value: string };

export type StartupOutputBlock =
  | { type: "message"; text: string }
  | { type: "fields"; fields: readonly StartupOutputField[] }
  | { type: "command"; text: string };

export type StartupOutputOptions = {
  leadingBlank?: boolean;
  width?: number;
};

export function formatStartupOutput(
  blocks: readonly StartupOutputBlock[],
  options: StartupOutputOptions = {},
) {
  const width = Math.max(40, options.width ?? 100);

  const output = blocks
    .map((block) => {
      if (block.type === "message") {
        return wrapText(block.text, width, "", "  ");
      }

      if (block.type === "fields") {
        return block.fields
          .flatMap(({ label, value }) =>
            wrapText(
              value,
              width,
              `  ${label}: `,
              " ".repeat(label.length + 4),
            ),
          )
          .join("\n");
      }

      return wrapText(block.text, width, "  ", "  ");
    })
    .join("\n\n");

  return `${options.leadingBlank ? "\n" : ""}${output}\n`;
}

export function formatStartupPrompt(prompt: string, width = 100) {
  const text = wrapText(`${prompt} [y/N]`, Math.max(40, width), "", "  ");

  return `\n${text} `;
}

function wrapText(
  text: string,
  width: number,
  firstPrefix: string,
  continuation: string,
) {
  const maxWidth = Math.max(
    width,
    firstPrefix.length + 1,
    continuation.length + 1,
  );

  const lines: string[] = [];
  let line = firstPrefix;

  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const separator = line === firstPrefix || line === continuation ? "" : " ";

    if (line.length + separator.length + word.length <= maxWidth) {
      line += separator + word;

      continue;
    }

    if (line !== firstPrefix && line !== continuation) {
      lines.push(line);
      line = continuation;
    }

    let remaining = word;

    while (line.length + remaining.length > maxWidth) {
      const chunkLength = maxWidth - line.length;
      line += remaining.slice(0, chunkLength);
      lines.push(line);
      line = continuation;
      remaining = remaining.slice(chunkLength);
    }

    line += remaining;
  }

  lines.push(line);

  return lines.join("\n");
}
