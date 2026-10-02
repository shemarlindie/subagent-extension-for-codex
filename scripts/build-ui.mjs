import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const [entry, template, output] of [
  ["ui/app.ts", "ui/console.html", "dist/console.html"],
  ["ui/codex.ts", "ui/codex.html", "dist/codex.html"],
]) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    minify: true,
  });
  const html = (await readFile(template, "utf8")).replace("/*__APP__*/", () =>
    result.outputFiles[0].text.replaceAll("</script", "<\\/script"),
  );
  // Parse the final embedded module too: String.replace replacement tokens can corrupt bundles.
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!module) throw new Error("Missing application module");
  await transform(module, { loader: "js" });
  await writeFile(output, html);
}
