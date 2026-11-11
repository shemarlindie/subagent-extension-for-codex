import { expect, test } from "vitest";

import { completeParagraphs, markdownParts } from "./complete-paragraphs";

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

test("splits into parts only where the text renders the same in pieces", () => {
  expect(markdownParts("One\n\n\nTwo")).toEqual(["One", "Two"]);

  // Lists and indented content can belong to the block before a blank line.
  expect(markdownParts("Steps:\n\n1. A\n\n   more\n\n- B\n\nAfter")).toEqual([
    "Steps:\n\n1. A\n\n   more\n\n- B",
    "After",
  ]);

  expect(markdownParts("Intro\n\n```\na\n\nb\n```\n\nAfter")).toEqual([
    "Intro",
    "```\na\n\nb\n```",
    "After",
  ]);

  // A definition applies to the whole text.
  expect(markdownParts("See[^1]\n\nMore\n\n[^1]: Note")).toEqual([
    "See[^1]\n\nMore\n\n[^1]: Note",
  ]);
});
