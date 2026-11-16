import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cutFootage, EditSchema, type PreparedFootage, prepareFootage, TranscriberSchema } from './footage.js';
import { parseProject, projectJsonSchema, type RenderResult } from './project.js';
import { defaultVideoPath, render } from './render.js';
import { reviewVideo } from './review.js';
import { BUILTIN_SFX } from './sfx.js';

const HELP = `cutsmith: a JSON script or your own recording in, a voiced, subtitled video out.

Usage:
  cutsmith render <project.json> [--out video.mp4] [--cover cover.jpg] [--fresh] [--fresh-scene 2,3] [--concurrency N]
      Renders the video and its cover. Writes <video>.render.json with the scene times and warnings.
  cutsmith validate <project.json>       Checks a project file and prints what is wrong.
  cutsmith schema                        Prints the JSON Schema of project files.
  cutsmith sfx                           Lists the built-in sound effects.

  cutsmith footage prepare <clip> --transcriber <transcriber.json> [--out-dir dir]
      Cleans the voice, splits it at the pauses and transcribes every chunk into <clip>.footage.json.
  cutsmith footage cut <clip.footage.json> <edit.json> --project <project.json> [--out-dir dir]
      Cuts the scenes of the edit and writes them into the project (created if missing).

  cutsmith review <project.json> --reviewer <reviewer.json> [--result <video>.render.json]
      AI check of the rendered video: hook score, summary and issues per scene, as JSON.

Docs: https://github.com/abhijeet-maharana/cutsmith`;

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const writeJson = (file: string, data: unknown) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
const resultFile = (video: string) => video.replace(/\.mp4$/i, '') + '.render.json';

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      cover: { type: 'string' },
      fresh: { type: 'boolean' },
      'fresh-scene': { type: 'string' },
      concurrency: { type: 'string' },
      transcriber: { type: 'string' },
      reviewer: { type: 'string' },
      result: { type: 'string' },
      project: { type: 'string' },
      'out-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;

  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  if (command === 'schema') {
    console.log(JSON.stringify(projectJsonSchema(), null, 2));
    return;
  }

  if (command === 'sfx') {
    for (const [name, s] of Object.entries(BUILTIN_SFX)) console.log(`${name.padEnd(13)} ${s.use}`);
    console.log('\nA file path or a URL works too.');
    return;
  }

  if (command === 'validate') {
    const project = parseProject(readJson(need(args[0], 'project.json')));
    console.log(`✅ Valid: ${project.scenes.length} scenes, ${project.format}`);
    return;
  }

  if (command === 'render') {
    const file = path.resolve(need(args[0], 'project.json'));
    const fresh = values.fresh ? true : values['fresh-scene'] ? values['fresh-scene'].split(',').map(Number) : false;
    const result = await render(readJson(file), {
      baseDir: path.dirname(file),
      out: values.out,
      cover: values.cover,
      fresh,
      concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    });
    writeJson(resultFile(result.video), result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'footage') {
    const [step, ...rest] = args;
    if (step === 'prepare') {
      const clip = need(rest[0], 'clip');
      const transcriber = TranscriberSchema.parse(readJson(need(values.transcriber, '--transcriber <transcriber.json>')));
      const footage = await prepareFootage(clip, { transcriber, outDir: values['out-dir'] });
      const out = path.join(path.dirname(footage.voice), `${path.parse(clip).name}.footage.json`);
      writeJson(out, footage);
      console.log(`✅ ${footage.chunks.length} chunks → ${out}`);
      return;
    }
    if (step === 'cut') {
      const footage = readJson(need(rest[0], 'clip.footage.json')) as PreparedFootage;
      const edit = EditSchema.parse(readJson(need(rest[1], 'edit.json')));
      const projectFile = path.resolve(need(values.project, '--project <project.json>'));
      const projectDir = path.dirname(projectFile);
      const prefix = path.parse(footage.source).name;
      const scenes = cutFootage(footage, edit.scenes, { outDir: path.resolve(values['out-dir'] ?? path.join(projectDir, 'footage')), prefix });
      const base = fs.existsSync(projectFile) ? readJson(projectFile) : { title: prefix, format: 'vertical' };
      const relative = (p?: string) => p && path.relative(projectDir, p);
      writeJson(projectFile, { ...base, scenes: scenes.map((s) => ({ ...s, visual: relative(s.visual), audio: relative(s.audio) })) });
      console.log(`✅ ${scenes.length} scenes → ${projectFile}`);
      return;
    }
    throw new Error('Usage: cutsmith footage prepare|cut ...');
  }

  if (command === 'review') {
    const file = path.resolve(need(args[0], 'project.json'));
    const project = parseProject(readJson(file));
    const reviewer = readJson(need(values.reviewer, '--reviewer <reviewer.json>'));
    const resultPath = values.result ?? resultFile(defaultVideoPath(project, path.dirname(file)));
    if (!fs.existsSync(resultPath)) throw new Error(`No render result at ${resultPath}: render first, or pass --result`);
    const review = await reviewVideo(project, readJson(resultPath) as RenderResult, reviewer, { baseDir: path.dirname(file) });
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  throw new Error(`Unknown command "${command}". Run cutsmith --help.`);
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`Missing ${what}. Run cutsmith --help.`);
  return value;
}

main(process.argv.slice(2)).catch((err: Error) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
