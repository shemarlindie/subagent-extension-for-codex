# Showcase captures

Use this guide to make the README's images and video. The showcase plays a
short, curated collaboration with a Codex-like thread beside the real panel. The
panel runs from the dev server through the same bridge as the dev host, so panel
changes appear without extra work.

With the [panel dev host](development.md#panel-dev-host) running, open
`http://127.0.0.1:5317/showcase.html`. The URL picks the frame:

- `step` is the 0-based story step. The default is the second-to-last.
- `theme` is `dark` (default) or `light`.
- `capture` hides the controls.
- `play` plays the whole story on a loop. Codex's items appear one at a time,
  and Codex opens the panel inline in its thread before expanding it into the
  side pane. Claude's replies stream, and the panel updates in place, as in a
  live run. The Play button toggles it.

Export every step in both themes at 1600×1000 and 2x scale:

```sh
npm run showcase:capture
```

It writes to `showcase-captures/`. Use `--out <dir>` for another folder, for
example to compare a version without replacing the standard captures, and
`--scale <n>` for another pixel ratio. Captures default to `--zoom 1.4`, which
enlarges the page by 40% within the same export size. Use `--zoom 1` for the
original page size, or another positive multiplier to tune readability.

Captures apply scale and zoom through CSS `zoom`, so panel animations that
measure elements must divide by `currentCSSZoom`, as `autoListEffects` does.

## Video and frame captures

Add `--video` to record one playback loop per theme as WebM video. Video
defaults to 60 fps at 3200×2000. Use `--fps <n>` for another frame rate and
`--scale 1` for a 1600×1000 export. Higher scales and frame rates take more
resources and produce larger files. The command reuses a running dev server or
starts one.

Add `--frames` to capture one playback loop per theme as lossless PNG frames,
for the GIF or the MP4. Chromium sends a frame only when the page changes, so
each `showcase-<theme>-frames/` folder includes a `frames.ffconcat` list with
each frame's timing. ffmpeg needs `-safe 0` to read it.

Video and frame captures record in real time, so frames can be lost two ways.
The screencast can skip frames when encoding falls behind, and the page can miss
frames when rendering is slow. Each capture traces the frames Chromium presents
and prints how many the screencast `missed`, with their playback times. It also
prints rendering counts. `partial` and `dropped` frames were late to the screen,
and `brief` frames were replaced within half a refresh, so a 60 Hz display
rarely shows them and they don't count as missed.

Captures use Metal GPU rendering, which exists only on macOS. Captures on other
platforms are untested. Counts vary between runs. Close busy apps, capture a few
times into separate `--out` folders and keep the run with the fewest missed and
dropped frames for each theme. On an Apple M5 Pro at 2x, the best of a few runs
has 0 missed and 2 to 4 dropped frames.

## MP4

Each MP4 and GIF in the README has a 10 MB budget, GitHub's attachment limit on
free plans. Build the MP4 from a WebM or from PNG frames captured at the default
2x. PNG frames skip the screencast's JPEG and VP8 steps, so the MP4 is smaller
at the same CRF. Text looks the same up close.

To convert each WebM, use these settings, which keep text sharp:

```sh
for t in dark light; do
  ffmpeg -i showcase-captures/showcase-$t.webm -c:v libx264 -preset slow \
    -tune animation -crf 12 -pix_fmt yuv420p -movflags +faststart -an \
    showcase-captures/showcase-$t.mp4
done
```

To encode PNG frames, use the same settings with the frame list. The `fps=60`
filter turns the list's variable frame times into a constant 60 fps:

```sh
npm run showcase:capture -- --frames
for t in dark light; do
  ffmpeg -safe 0 -f concat \
    -i showcase-captures/showcase-$t-frames/frames.ffconcat \
    -vf "fps=60,format=yuv420p" -c:v libx264 -preset slow -tune animation \
    -crf 12 -movflags +faststart -an showcase-captures/showcase-$t.mp4
done
```

To add background music, mix a track into an MP4 without re-encoding its video.
Make the MP4 with the lowest CRF that fits the budget with 128 kbps audio. That
is usually `-crf 11` from PNG frames and `-crf 13` to `-crf 15` from a WebM, and
keeps text sharper than scaling the video down. The mix takes the track from its
start, cuts it to the video's length, sets it to 35% volume and fades it out
over the last second:

```sh
for t in dark light; do
  v=showcase-captures/showcase-$t.mp4
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $v)
  ffmpeg -i $v -i music.mp3 -filter_complex \
    "[1:a]atrim=0:$d,asetpts=PTS-STARTPTS,volume=0.35,afade=t=out:st=$(echo "$d - 1" | bc):d=1[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -movflags +faststart \
    -shortest showcase-captures/showcase-$t-music.mp4
done
```

## GIF

Capture PNG frames at the GIF's width, 1440 px with `--scale 0.9`. Scaling
frames down to the GIF's width softens text, and the resampled colors make the
GIF larger. Use a separate `--out` folder to keep 2x frames for the MP4. Build
the GIF with ffmpeg and [gifsicle](https://www.lcdf.org/gifsicle/)
(`brew install gifsicle`):

```sh
npm run showcase:capture -- --frames --scale 0.9
for t in dark light; do
  ffmpeg -safe 0 -f concat \
    -i showcase-captures/showcase-$t-frames/frames.ffconcat \
    -filter_complex "fps=100/3,split[a][b];\
[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
    /tmp/showcase-$t.gif
  gifsicle -O3 /tmp/showcase-$t.gif -o showcase-captures/showcase-$t.gif
done
```

The palette comes from the frames themselves, and `dither=none` keeps flat UI
and text crisp. `diff_mode=rectangle` redraws only the changed area of each
frame. Both themes use the same settings, and neither needs lossy compression to
fit the budget.

GIF frame delays use whole hundredths of a second, so 50, 33⅓, 25 and 20 fps
keep even timing. The GIF uses 33⅓ fps because 50 fps makes it much larger,
which would cut the width that fits the budget to about 1136 px. The GIF favors
readable text, and the linked MP4 shows smooth 60 fps motion. Some renderers
also slow 20 ms frames to 100 ms.

## README media

The README shows both GIFs and links to the dark MP4 with music. They are GitHub
attachments, so no media is committed. To replace one, drag the new file into an
issue, pull request or discussion comment in a browser, copy the
`user-attachments` URL it inserts without submitting the comment, and update the
URL in `README.md`. Keep the image's `width` at the GIF's width. The GitHub
mobile app rejects video uploads.

## Story and playback

The story lives in `dev/panel/showcase/story.ts`. Each step lists the items
Codex adds and builds Claude's events with the fixture `Timeline`. A step's
`reply` holds the message that ends Claude's turn, which playback streams.
Playback timing lives in `dev/panel/showcase/playback.ts`. The Codex look lives
in `dev/panel/showcase/codex/`. Update it there when Codex changes.

The showcase freezes the panel's clock, so elapsed times are the same in every
capture.
