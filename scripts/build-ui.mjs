import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const result = await build({
  entryPoints: ["ui/app.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  minify: true,
});
await mkdir("dist", { recursive: true });
const html = (await readFile("ui/console.html", "utf8")).replace(
  "/*__APP__*/",
  () => result.outputFiles[0].text.replaceAll("</script", "<\\/script"),
);
// Parse the final embedded module too: String.replace replacement tokens can corrupt bundles.
const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!module) throw new Error("Missing application module");
await transform(module, { loader: "js" });
await writeFile("dist/console.html", html);
