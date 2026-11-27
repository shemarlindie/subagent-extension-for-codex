// Joins each comparison side's recording and stills into one row.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { concatInput, ENCODING } from "./panel-mp4";

const DIVIDER = "0xdce2ea";

export type Recorded = {
  /** The side's recording folder. */
  dir: string;
  played: boolean;
  stills: string[];
};

/** Joins one input per side into a row, as a video or a still. */
async function composeRow(
  inputs: string[][],
  width: number,
  file: string,
  video: boolean,
) {
  const prepare = video ? "fps=60,setpts=PTS-STARTPTS" : "null";

  const streams = inputs.map((_, index) => `[${index}:v]${prepare}[v${index}]`);

  const dividers = inputs
    .slice(1)
    .map(
      (_, index) =>
        `drawbox=x=${(index + 1) * width - 1}:y=0:w=2:h=ih:color=${DIVIDER}:t=fill`,
    );

  // A side that finishes first holds its last frame until the longest ends.
  const row = [
    `${inputs.map((_, index) => `[v${index}]`).join("")}hstack=inputs=${inputs.length}`,
    ...dividers,
    ...(video ? ["format=yuv420p"] : []),
  ];

  await promisify(execFile)("ffmpeg", [
    ...["-y", "-v", "error", ...inputs.flat()],
    ...["-filter_complex", [...streams, row.join(",")].join(";")],
    ...(video ? ENCODING : ["-frames:v", "1"]),
    file,
  ]);
}

/**
 * Writes `comparison.mp4` when the sides played, and `<name>.png` for each
 * still they took.
 */
export async function composeComparison(
  sides: Recorded[],
  width: number,
  out: string,
) {
  const played = sides.filter((side) => side.played).length;

  if (played === sides.length) {
    await composeRow(
      sides.map(({ dir }) => concatInput(join(dir, "frames"))),
      width,
      join(out, "comparison.mp4"),
      true,
    );
  } else if (played > 0) {
    throw new Error("Every side plays, or none");
  }

  const stills = sides[0]?.stills ?? [];

  const same = (names: string[]) =>
    names.toSorted().join() === stills.toSorted().join();

  if (!sides.every((side) => same(side.stills))) {
    throw new Error("Every side takes the same stills");
  }

  for (const name of stills) {
    await composeRow(
      sides.map(({ dir }) => ["-i", join(dir, `${name}.png`)]),
      width,
      join(out, `${name}.png`),
      false,
    );
  }
}
