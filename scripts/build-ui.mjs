import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { build, parseAst } from "vite";

await mkdir("dist", { recursive: true });

// The page embeds its CSS as text, so relative `@import "./x.css";` lines are expanded in place.
async function inlineImports(file) {
  const source = await readFile(file, "utf8");
  const parts = [];
  let last = 0;

  for (const match of source.matchAll(/^@import "(\.[^"]+)";\n/gm)) {
    parts.push(source.slice(last, match.index));
    parts.push(await inlineImports(resolve(dirname(file), match[1])));
    last = match.index + match[0].length;
  }

  parts.push(source.slice(last));

  const css = parts.join("");

  // An import in any other form would stay in the page and be ignored, silently dropping styles.
  if (/@import\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")))
    throw new Error(
      `Unsupported @import in ${file}; use @import "./file.css";`,
    );

  return css;
}

{
  const entry = "ui/entries/app.ts",
    template = "ui/templates/app.html",
    stylesheet = "ui/styles/app.css",
    output = "dist/app.html";

  // Ignore vite.config.ts: it configures the dev host, not production bundles.
  const result = await build({
    configFile: false,
    logLevel: "warn",
    plugins: [react()],
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      write: false,
      minify: true,
      modulePreload: false,
      rolldownOptions: {
        input: resolve(entry),
        output: { format: "es", codeSplitting: false },
      },
    },
  });

  const chunks = [result]
    .flat()
    .flatMap((bundle) => bundle.output)
    .filter((file) => file.type === "chunk");

  if (chunks.length !== 1)
    throw new Error(`Expected one bundle chunk, got ${chunks.length}`);

  const css = await inlineImports(stylesheet);

  const html = (await readFile(template, "utf8"))
    .replace("/*__CSS__*/", () => css)
    .replace("/*__APP__*/", () =>
      chunks[0].code.replaceAll("</script", "<\\/script"),
    );

  // Parse the final embedded module too: String.replace replacement tokens can corrupt bundles.
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!module) throw new Error("Missing application module");
  parseAst(module);
  await writeFile(output, html);
}
