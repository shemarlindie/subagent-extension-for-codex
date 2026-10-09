import { readPackageFile } from "../service/runtime.js";

const glyphs = [
  { theme: "light", file: "product-glyph-black.svg" },
  { theme: "dark", file: "product-glyph-white.svg" },
] as const;

export const productGlyphIcons = glyphs.map(({ theme, file }) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(readPackageFile("assets", file).trim()).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));
