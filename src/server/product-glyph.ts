import { readFileSync } from "node:fs";

// The same package-root path works from both src/server and dist/server.
const productGlyphSvg = readFileSync(
  new URL("../../assets/product-glyph.svg", import.meta.url),
  "utf8",
).trim();

// Standalone MCP icons cannot inherit the sidebar's currentColor, so expose
// explicit foreground colors for clients using light and dark backgrounds.
export const productGlyphIcons = (
  [
    { theme: "light", color: "#202124" },
    { theme: "dark", color: "#f5f5f5" },
  ] as const
).map(({ theme, color }) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(productGlyphSvg.replaceAll("currentColor", color)).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));
