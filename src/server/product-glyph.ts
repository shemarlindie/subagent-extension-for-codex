import { readFileSync } from "node:fs";

// These package-root paths resolve from both src/server and dist/server.
const glyphs = [
  { theme: "light", path: "../../assets/product-glyph-black.svg" },
  { theme: "dark", path: "../../assets/product-glyph-white.svg" },
] as const;

export const productGlyphIcons = glyphs.map(({ theme, path }) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(readFileSync(new URL(path, import.meta.url), "utf8").trim()).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));
