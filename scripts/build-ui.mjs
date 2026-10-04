import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { build, parseAst } from "vite";

await mkdir("dist", { recursive: true });

for (const [entry, template, stylesheet, output] of [
  [
    "ui/entries/console.ts",
    "ui/templates/console.html",
    "ui/styles/console.css",
    "dist/console.html",
  ],
  [
    "ui/entries/panel.ts",
    "ui/templates/codex.html",
    "ui/styles/codex.css",
    "dist/codex.html",
  ],
]) {
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

  const css =
    (await readFile(stylesheet, "utf8")) +
    "\n" +
    (await readFile("ui/styles/shared.css", "utf8"));

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
