# cutsmith

**Video engine for AI agents.** Your agent writes a JSON script, or you hand it your own recording. cutsmith gives back a voiced, subtitled video with a cover: vertical for Shorts and Reels, or 16:9 for YouTube.

```bash
cutsmith render project.json
# → out/my-video.mp4, out/my-video-cover.jpg, out/my-video.render.json
```

It grew out of the pipeline that makes a daily Reels and Shorts channel, pulled out so anyone can use it.

## What you get

| Feature | What it does |
|:---|:---|
| **Voice per scene** | Each line is voiced on its own through any OpenAI-compatible speech endpoint (OpenAI, a Gemini TTS proxy, a local Kokoro server). Takes are cached, so editing one line re-voices only that line |
| **Karaoke subtitles** | Word timing is **measured from the audio** (ffmpeg finds the real pauses), so words light up within ~0.1 s of being spoken. No alignment API needed |
| **Smart layouts** | Picked from each file's shape: a visual of the canvas's shape fills it, a tall app screenshot goes in a phone frame and scrolls, a photo of another shape is shown whole over a blurred copy |
| **Hook** | A big on-screen hook for the first ~2 s, with a punch-in and a flash |
| **Cues** | A badge, a screenshot scroll or a sound effect starts on a chosen **narration word** |
| **Your own footage** | Clean the voice of a recording, split it at the pauses, transcribe it, let your agent pick the chunks, cut them into scenes |
| **Finish** | Background music that loops under the voice, an end card, a progress bar, whoosh transitions, and a −14 LUFS master (the loudness Reels, Shorts and YouTube play at) |
| **AI check** | Optional: a multimodal model watches frames from every scene and reports what a viewer would notice (covered text, wrong visual, black frames, audio problems) |
| **Retention lint** | For vertical videos: warnings for a slow hook, a static opening, long stills and a missing call to action. They never block the render |
| **Missing visuals** | A scene with no visual renders a labelled **VISUAL NEEDED** slot instead of a guess, so nobody posts it by mistake |

## Requirements

- **Node.js 22.13+**
- **ffmpeg and ffprobe** on your PATH
- Chrome is downloaded by Remotion on the first render (~140 MB). On Linux, `$CHROMIUM_PATH` or a system Chrome is used if present

## Quick start

```bash
git clone https://github.com/abhijeet-maharana/cutsmith.git
cd cutsmith && npm install
npm run example        # renders examples/hello/project.json, no API keys needed
```

The example uses `"voice": { "provider": "none" }`: silent scenes timed like speech, good for drafts and tests. To hear a voice, swap in one of [`examples/config/voice-*.json`](examples/config) and set its key.

To run `cutsmith` from anywhere: `npm link` inside the repo.

## The project file

One JSON file describes the video. Paths are relative to the file, then to each folder in `assetDirs`. Run `cutsmith schema` for the full [JSON Schema](schema/project.schema.json); editors use it for autocomplete through `$schema`.

```json
{
  "$schema": "./node_modules/cutsmith/schema/project.schema.json",
  "title": "Stop editing by hand",
  "format": "vertical",
  "brand": "brand.json",
  "assetDirs": ["assets"],
  "voice": { "provider": "openai-compatible", "model": "gpt-4o-mini-tts", "voice": "ash" },
  "music": { "file": "music/upbeat.mp3", "volume": 0.025 },
  "scenes": [
    {
      "id": 1,
      "text": "Stop editing videos by hand. Let your agent write them.",
      "hookText": "Stop editing by hand",
      "visual": "clip.mp4",
      "sfx": { "sound": "whip", "cue": "agent" }
    },
    {
      "id": 2,
      "text": "Your agent writes one JSON file: the lines, the visuals and the cues.",
      "visual": "app-screenshot.png",
      "badge": "📄 project.json",
      "badgeCue": "JSON",
      "panCue": ["lines", "cues"]
    }
  ],
  "endCard": { "headline": "Try cutsmith", "button": "STAR ON GITHUB", "url": "github.com/abhijeet-maharana/cutsmith" }
}
```

### Scene fields

| Field | Meaning |
|:---|:---|
| `text` | Exact narration. It is voiced and shown as subtitles |
| `visual` | Image or video: a path, a URL, or a bare name found in `assetDirs`. Leave it out to get a VISUAL NEEDED slot |
| `visualNeeded` | Plain description of the shot, shown in that slot |
| `audio` | The scene's own recorded voice. Used instead of TTS |
| `layout` | `fullbleed`, `framed` or `fitted`. Normally picked from the file's shape |
| `hookText`, `hookTone`, `hookPosition` | Scene 1 hook: ≤ 6 words; tone `alert` (red), `curiosity` (yellow) or `proof` (green); position `top` or `center` |
| `badge`, `badgeCue` | A small label at the top, shown when the cue word is spoken |
| `panY`, `panCue` | Framed screenshots: scroll from `panY[0]`% to `panY[1]`%, between two narration words |
| `sfx` | `{ "sound": "ding", "cue": "word" }`. `cutsmith sfx` lists the built-ins; a file path or URL works too |
| `hideSubtitles` | No subtitles on this scene |

### Brand

```json
{
  "colors": { "background": "#111827", "backgroundDeep": "#030712", "accent": "#38BDF8", "onAccent": "#030712", "text": "#FFFFFF", "frame": "#1F2937" },
  "font": { "family": "Inter", "googleFont": "Inter:wght@700;800;900" },
  "logo": "logo-white.png"
}
```

Fonts come from Google Fonts (`googleFont`, needs network while rendering) or local files (`"files": [{ "src": "fonts/MyFont-Bold.ttf", "weight": "700" }]`). The render waits for them, so no frame uses a fallback font.

## Your own footage

For videos cut from a recording, with your real voice:

```bash
# 1. Clean the voice, split at the pauses, transcribe every chunk → talk.footage.json
cutsmith footage prepare talk.mp4 --transcriber examples/config/transcriber-whisper.json

# 2. Your agent reads talk.footage.json and writes edit.json: the chunks to keep, in order, grouped into scenes
#    { "scenes": [ { "chunks": [2, 3], "hookText": "This took me 3 years" }, { "chunks": [7, 8, 9] } ] }

# 3. Cut those scenes into the project, then render
cutsmith footage cut talk.footage.json edit.json --project project.json
cutsmith render project.json
```

Every cut lands in a pause and gets a 30 ms fade, so joins don't click. The transcriber is any OpenAI-compatible Whisper endpoint, or a chat model that takes audio (`"kind": "chat"`), which is better at mixed languages.

## AI check

```bash
cutsmith review project.json --reviewer examples/config/reviewer.json
```

It returns a hook score (0–10), a one-line verdict and issues per scene as JSON. Any chat model that takes images works. Set `"audio": true` only if the model also takes audio. `references` lets it compare a shot against a real product photo.

## Use it from code

```ts
import { render, reviewVideo, type VoiceProvider } from 'cutsmith';

const result = await render(project, { baseDir: '/path/to/project', out: 'out/video.mp4', concurrency: 2 });
// result.scenes → where each scene starts and ends; result.warnings → retention lint
```

Bring your own voice by passing `voice: VoiceProvider` (one method, `speak(text, outFile, { fresh })`) to `render()`.

## Using it with an agent

[`skills/cutsmith/SKILL.md`](skills/cutsmith/SKILL.md) is a ready skill for Claude Code and other agents that load skills. It tells the agent how to write a project, render it, read the warnings and fix them. Copy it to `.claude/skills/cutsmith/` in your project.

## Licences

- **cutsmith** is MIT.
- It renders with **[Remotion](https://www.remotion.dev)**, which has its own licence: free for individuals, non-profits and companies of up to 3 people; larger companies need a [Remotion company licence](https://www.remotion.dev/license). Check it before using cutsmith at work.
- **Built-in sound effects** are streamed from [remotion.media](https://www.remotion.dev/docs/sfx) while rendering, not shipped here. Each sound has its own licence on its page there.
- You bring your own music, fonts, logo and visuals, and their licences are yours to check.
