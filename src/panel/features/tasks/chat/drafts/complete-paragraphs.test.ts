import { expect, test } from "vitest";

import { completeParagraphs } from "./complete-paragraphs";

test("keeps text up to the last blank line", () => {
  expect(completeParagraphs("One")).toBe("");
  expect(completeParagraphs("One\n")).toBe("");
  expect(completeParagraphs("One\n\n")).toBe("One");
  expect(completeParagraphs("One\n\nTwo\nstill two")).toBe("One");
  expect(completeParagraphs("One\n  \nTwo\n\nThr")).toBe("One\n  \nTwo");
});

test("holds a code block until it closes", () => {
  const open = "Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n";
  expect(completeParagraphs(open)).toBe("Intro");
  expect(completeParagraphs(`${open}\`\`\`\n`)).toBe("Intro");

  expect(completeParagraphs(`${open}\`\`\`\n\nNext`)).toBe(`${open}\`\`\``);
});

test("closes a fence only with a bare matching marker as long as the opening", () => {
  const text = "````\n```\n\n~~~\n\n````md\n\n````\n\nAfter";
  expect(completeParagraphs(text)).toBe("````\n```\n\n~~~\n\n````md\n\n````");
});
