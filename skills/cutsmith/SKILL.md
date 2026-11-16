---
name: cutsmith
description: Make a voiced, subtitled video (vertical Short/Reel or 16:9 YouTube) with the cutsmith CLI, from a script or from a recording. Trigger on: make a video, render a reel, make a short, cut my recording into a short, cutsmith.
---

# cutsmith

You write a `project.json`; `cutsmith render` makes the MP4 and a cover. Run `cutsmith --help` for every command and `cutsmith schema` for every field.

## From a script

1. **Write `project.json`** next to the visuals (or list their folders in `assetDirs`):
   - **4–6 scenes** for a 20–45 s Short. One idea per scene, 1–2 short sentences of `text`.
   - **Scene 1** opens on the problem: `hookText` of ≤ 6 words, and a first sentence of ≤ 12 words.
   - **Every scene gets a `visual`** that literally shows its line, plus a `visualNeeded` description. Never put an unrelated picture in to fill a gap: leave `visual` out and the render shows a VISUAL NEEDED slot.
   - The visuals should change every 3–5 s, so split a long line over two scenes rather than holding one still.
   - The **last scene asks for something**: save, share, follow or comment.
   - Cues (`badgeCue`, `panCue`, `sfx.cue`) must be words that appear in that scene's `text`.
2. **`cutsmith validate project.json`**, then **`cutsmith render project.json`**.
3. **Read the JSON it prints:**
   - `missingVisuals`: scenes still needing a visual. Find or make one, or ask for it.
   - `warnings`: retention problems (slow hook, static opening, long still, no ask). Fix them in the script and render again; cached voice takes make this cheap.
4. **Look at the video before calling it done**: frames from each scene (`ffmpeg -ss <t> -i video.mp4 -frames:v 1 frame.jpg`) or `cutsmith review` if a reviewer config exists. Check that text isn't covered, screenshots are readable and each picture matches its line.

## From a recording

1. `cutsmith footage prepare talk.mp4 --transcriber <transcriber.json>` writes `talk.footage.json`: numbered chunks of speech with their text.
2. Read the chunks and write `edit.json`: `{ "scenes": [ { "chunks": [2, 3], "hookText": "..." }, ... ] }`. Keep the strongest lines, drop fillers, false starts and repeats. Open on the most surprising line, even if it was said later.
3. `cutsmith footage cut talk.footage.json edit.json --project project.json`, then render as above.

## Gotchas

- **Fresh takes:** `--fresh-scene 2` re-voices one scene when a take sounds wrong; the new take replaces the cached one.
- **No key?** `"voice": { "provider": "none" }` renders silent, correctly timed drafts.
- **First render** downloads Chrome (~140 MB) and takes a few minutes; later renders are faster.
