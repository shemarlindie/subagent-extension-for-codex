import {
  applyPatch,
  diffLines,
  structuredPatch,
  type StructuredPatchHunk as Hunk,
} from "diff";
import parseDiff from "parse-diff";
import { describe, expect, it } from "vitest";

import { composeHunks, formatFileDiff } from "./compose.js";

function patch(before: string, after: string, context = 3) {
  return structuredPatch("file.txt", "file.txt", before, after, "", "", {
    context,
  }).hunks;
}

function composeVersions(versions: string[], created = false, context = 3) {
  let hunks: Hunk[] = [];

  for (let index = 1; index < versions.length; index++) {
    hunks = composeHunks(
      hunks,
      patch(versions[index - 1]!, versions[index]!, context),
      created,
    );
  }

  return hunks;
}

function changedLines(hunks: Hunk[]) {
  return hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => /^[+-]/u.test(line)).length;
}

describe("composeHunks", () => {
  it("cancels added and removed lines across a known region (C2)", () => {
    const base = "first\nsecond\nthird\n";
    const intermediate = "first\nthird\n";
    const restored = "first\nsecond\nthird\n";
    expect(composeVersions([base, intermediate, restored])).toEqual([]);
    expect(composeVersions(["", base, intermediate, ""], true)).toEqual([]);
  });

  it("keeps hunks separate across unknown lines and limits context (C1)", () => {
    const base = Array.from(
      { length: 30 },
      (_, index) => `line ${index}\n`,
    ).join("");

    const first = base.replace("line 2\n", "first edit\n");
    const final = first.replace("line 25\n", "second edit\n");
    const hunks = composeVersions([base, first, final], false, 1);
    expect(hunks).toHaveLength(2);
    expect(hunks.every((hunk) => hunk.oldLines === 3)).toBe(true);
    expect(applyPatch(base, formatFileDiff("file.txt", hunks))).toBe(final);
  });

  it("keeps large created files within ordinary array call limits (C1)", () => {
    const count = 130_000;

    const edit: Hunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: count,
      lines: Array.from({ length: count }, (_, index) => `+line ${index}`),
    };

    const [composed] = composeHunks([], [edit], true);
    expect(composed?.newLines).toBe(count);
    expect(composed?.lines.at(-1)).toBe(`+line ${count - 1}`);
  });

  it.each([
    ["one", "one\n", "one"],
    ["one\n", "one", "one\n"],
    ["one", "two", "three"],
    ["first\nlast", "first\nlast\nnew", "first\nlast\nnew\n"],
    ["first\nlast", "first", ""],
    ["", "one", "one\ntwo"],
  ])("preserves final newline changes through %j (C3)", (...versions) => {
    const hunks = composeVersions(versions);

    expect(applyPatch(versions[0], formatFileDiff("file.txt", hunks))).toBe(
      versions.at(-1),
    );

    if (versions[0] === versions.at(-1)) expect(hunks).toEqual([]);
  });

  it.each([0, 1, 2])(
    "places pure insertions at offset %i in both conventions (C4)",
    (offset) => {
      const base = "first\nsecond\n";
      const lines = ["first", "second"];
      lines.splice(offset, 0, "inserted");
      const after = lines.join("\n") + "\n";
      const jsdiff = patch(base, after, 0);

      const claude = jsdiff.map((hunk) => ({
        ...hunk,
        oldStart: hunk.oldStart - 1,
      }));

      expect(
        applyPatch(base, formatFileDiff("file.txt", composeHunks([], jsdiff))),
      ).toBe(after);

      expect(composeHunks([], claude)).toEqual(composeHunks([], jsdiff));
    },
  );

  it("places insertion-only hunks after earlier hunks change the line count (C4)", () => {
    const base = "a\nb\nc\nd\ne\nf\n";
    const after = "first\nsecond\na\nb\nc\nd\ne\nf\nlast\n";
    const hunks = composeHunks([], patch(base, after, 0));
    expect(applyPatch(base, formatFileDiff("file.txt", hunks))).toBe(after);
  });

  it("rejects contradictory context, removals and EOF markers (C5)", () => {
    const stored = patch("one\ntwo\n", "one\nthree\n");

    expect(() =>
      composeHunks(stored, patch("other\nthree\n", "changed\nthree\n")),
    ).toThrow(/contradicts/u);

    expect(() =>
      composeHunks(stored, patch("one\nother\n", "one\nfour\n")),
    ).toThrow(/contradicts/u);

    expect(() =>
      composeHunks(stored, patch("one\nthree", "one\nfour")),
    ).toThrow(/contradicts/u);

    expect(() =>
      composeHunks(
        patch("", "one", 0),
        patch("one\nextra\n", "one\nextra\nlast\n", 0),
        true,
      ),
    ).toThrow(/end/u);
  });

  it("rejects malformed hunk bodies and overlapping coordinates (C5)", () => {
    const hunk = patch("old\n", "new\n")[0]!;

    expect(() => composeHunks([], [{ ...hunk, oldLines: 2 }])).toThrow(
      /counts/u,
    );

    expect(() =>
      composeHunks([], [{ ...hunk, lines: ["?old", "+new"] }]),
    ).toThrow(/operation/u);

    expect(() =>
      composeHunks([], [{ ...hunk, lines: ["\\ No newline at end of file"] }]),
    ).toThrow(/marker/u);

    expect(() => composeHunks([], [hunk, hunk])).toThrow(/overlap/u);
  });
});

describe("formatFileDiff", () => {
  it.each([
    ["old\n", "new\n", false, false],
    ["", "new", true, false],
    ["old", "", false, true],
  ])(
    "formats readable Git diffs with matching statistics (C6)",
    (before, after, created, deleted) => {
      const hunks = composeHunks([], patch(before, after), created);

      const formatted = formatFileDiff(
        "folder/file.txt",
        hunks,
        created,
        deleted,
      );

      const [parsed] = parseDiff(formatted);

      expect(formatted).toContain(
        "diff --git a/folder/file.txt b/folder/file.txt\n",
      );

      expect(formatted).not.toContain("===");

      expect(formatted).toContain(
        `--- ${created ? "/dev/null" : "a/folder/file.txt"}\n`,
      );

      expect(formatted).toContain(
        `+++ ${deleted ? "/dev/null" : "b/folder/file.txt"}\n`,
      );

      expect(parsed?.additions).toBe(
        hunks
          .flatMap((hunk) => hunk.lines)
          .filter((line) => line.startsWith("+")).length,
      );

      expect(parsed?.deletions).toBe(
        hunks
          .flatMap((hunk) => hunk.lines)
          .filter((line) => line.startsWith("-")).length,
      );

      expect(applyPatch(before, formatted)).toBe(after);
    },
  );
});

/** Seeded edits exercise the persisted net diff, not a retained in-memory model. */
function runFuzz(context: number, created: boolean, repeated: boolean) {
  let seed = 17 + context;

  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed / 2 ** 32;
  };

  const pick = (count: number) => Math.floor(random() * count);
  let serial = 0;

  const nextLine = () =>
    repeated ? `word ${pick(4)}` : `unique line ${serial++}`;

  const render = (lines: string[], newline: boolean) =>
    lines.join("\n") + (lines.length && newline ? "\n" : "");

  for (let run = 0; run < 200; run++) {
    let lines = created ? [] : Array.from({ length: pick(30) }, nextLine);
    const base = render(lines, random() > 0.5);
    let current = base;
    let hunks: Hunk[] = [];
    const versions = [{ lines, text: base }];

    for (let step = 0; step < 6; step++) {
      let next: string;

      if (random() < 0.15) {
        const version = versions[pick(versions.length)]!;
        lines = version.lines;
        next = version.text;
      } else {
        lines = [...lines];

        for (
          let operation = 0, count = 1 + pick(3);
          operation < count;
          operation++
        ) {
          const at = pick(lines.length + 1);

          lines.splice(
            at,
            pick(4),
            ...Array.from({ length: pick(4) }, nextLine),
          );
        }

        next = render(lines, random() > 0.5);
      }

      const edit = patch(current, next, context);

      // Claude uses the preceding line as oldStart for context-free insertions.
      if (run % 2) {
        for (const hunk of edit) {
          if (hunk.oldLines === 0) hunk.oldStart--;
        }
      }

      hunks = composeHunks(hunks, edit, created);

      expect(
        applyPatch(base, formatFileDiff("file.txt", hunks, created)),
        `run ${run}, step ${step}`,
      ).toBe(next);

      if (!repeated) {
        if (base === next) expect(hunks).toEqual([]);

        const minimal = diffLines(base, next)
          .filter((part) => part.added || part.removed)
          .reduce((total, part) => total + part.count, 0);

        expect(changedLines(hunks)).toBe(minimal);
      }

      versions.push({ lines, text: next });
      current = next;
    }
  }
}

describe("seeded composition fuzz", () => {
  for (const context of [0, 1, 3]) {
    for (const created of [false, true]) {
      for (const repeated of [false, true]) {
        it(`replays context=${context}, created=${created}, repeated=${repeated} (C1 to C4)`, () => {
          runFuzz(context, created, repeated);
        });
      }
    }
  }
});
