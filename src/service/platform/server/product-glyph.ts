import { readPackageFile } from "../service/runtime.js";

const glyphs = [
  { theme: "light", file: "brand-glyph-black.svg" },
  { theme: "dark", file: "brand-glyph-white.svg" },
] as const;

export const productGlyphIcons = glyphs.map(({ theme, file }) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(readPackageFile("assets", "brand", file).trim()).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));
