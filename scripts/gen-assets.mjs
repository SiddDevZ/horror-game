// generates the ai-made ui/poster/label/logo assets through the local mchat gateway.
// raw model output goes to $GEN_RAW (default /tmp/horror-gen-raw); cleanup/packing is
// done by scripts/gen-post.mjs. needs the gpt-image-mchat skill helper (see README in
// public/assets/gen). usage: node scripts/gen-assets.mjs [id ...] [--force] [--jobs=4]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const RAW = process.env.GEN_RAW || '/tmp/horror-gen-raw';
const GEN = process.env.GEN_HELPER || join(homedir(), '.claude/skills/gpt-image-mchat/gen.mjs');

const ICON_STYLE =
  'Authentic Minecraft inventory item sprite, true 16x16 pixel art: the whole object is drawn on a grid of only 16 by 16 big chunky square pixels, ' +
  'hard edges, no anti-aliasing, no gradients, flat shading with 2-3 tones per colour, limited palette, a 1-pixel very dark outline, ' +
  'simple bold readable silhouette, centered, filling most of the frame. Transparent background, no shadow, no text, no border.';

const icon = (id, subject) => ({
  id, kind: 'icon', size: '1024x1024', transparent: true, prompt: `${subject}. ${ICON_STYLE}`,
});

const POSTER_STYLE =
  'Tall portrait 2:3 printed paper poster, flat front-on scan filling the entire frame edge to edge (no wall, no frame around the paper, no perspective), ' +
  'slightly aged office print with faint creases, all text spelled exactly as given and clearly legible. No real people, no photographs of faces.';

const poster = (id, body) => ({
  id, kind: 'poster', size: '1024x1536', quality: 'medium', prompt: `${body} ${POSTER_STYLE}`,
});

export const JOBS = [
  icon('almond_water', 'A small clear plastic bottle of almond water: pale cream-white milky liquid inside, light blue screw cap, small beige label band'),
  icon('airhorn', 'A handheld air horn: red cylindrical gas canister at the bottom with a white plastic trumpet horn flaring out on top'),
  icon('vhs_tape', 'A black VHS video cassette tape seen from the front, with a white paper label strip and two small visible tape reel windows'),
  icon('breaker', 'A bright yellow electric lightning bolt symbol, zig-zag shape'),
  icon('exit_door', 'A simple low-detail green door standing slightly open with bright white light in the gap, big chunky pixels, very few details'),
  icon('phone', 'A simple low-detail old red telephone handset (just the curved handset, no base), big chunky pixels, very few details'),
  icon('compass_arrow', 'A compass needle arrow pointing straight up: the upper half is a red pointed tip, the lower half is light grey, with a small dark pin in the middle'),
  icon('skull', 'A white cartoon skull with dark eye sockets, front view'),
  icon('trophy', 'A shiny gold trophy cup with two handles on a small dark brown base'),
  icon('note', 'A sheet of yellowed old paper note with a folded top-right corner and a few dark scribbled lines of handwriting'),
  poster('meg_notice',
    'Bureaucratic workplace safety poster in the style of a 1980s government notice. Yellow and black hazard stripes along the top and bottom. ' +
    'Header text: "M.E.G. SAFETY NOTICE". Big bold text: "DO NOT MAKE EYE CONTACT WITH THE PNG". ' +
    'In the middle a simple black pictogram: a stick figure turning its head away from a tall thin rectangular figure that has a plain white smiley face made of two dots and a curve. ' +
    'Small footer text: "Report all smiles to your supervisor."'),
  poster('employee_month',
    'Corporate "EMPLOYEE OF THE MONTH" certificate poster. Ornate gold picture frame in the middle containing only an empty photo of plain yellow wallpaper, nobody in it. ' +
    'Header text: "EMPLOYEE OF THE MONTH". Name plate under the frame: "NOBODY (AGAIN)". Small text: "Month: ongoing". Beige paper, navy blue text, a gold star seal in the corner.'),
  poster('poster_almond',
    'Retro 1970s public service advertisement poster, warm cream background, bold orange and brown colours. A friendly illustrated plastic bottle of milky almond water with a light blue cap in the centre, with a few almonds around it. ' +
    'Huge headline text: "STAY HYDRATED". Second line: "DRINK ALMOND WATER". Small footer text: "It is probably fine."'),
  poster('have_you_seen',
    'Photocopied black and white missing-person flyer. Headline: "HAVE YOU SEEN THIS MAN?". In the middle a plain black featureless silhouette of a head and shoulders with a big white question mark on it, no face. ' +
    'Text under it: "LAST SEEN: LEVEL 0". "Answers to: Kevin". A row of vertical tear-off phone number tabs at the bottom edge. Grainy photocopy texture, a piece of tape at the top.'),
  poster('not_a_vibe',
    'Parody of a classic motivational office poster: thick black border, in the centre a moody photograph of an empty yellow office room with damp beige carpet and buzzing fluorescent ceiling lights, no people. ' +
    'Under the photo, large elegant white serif capitals: "LEVEL 0". Beneath in smaller white serif: "is not a vibe."'),
  poster('moist_carpet',
    'Yellow plastic-style caution sign poster. Big black triangle warning icon with a stick figure slipping. Text: "CAUTION". Big text: "MOIST CARPET". Small text: "Do not ask why. Do not ask what." Bold simple safety-sign design.'),
  {
    id: 'vhs_label', kind: 'label', size: '1536x1024', quality: 'medium',
    prompt: 'Flat scan of a single white VHS cassette sticker label, filling the entire frame edge to edge, no cassette, no background. ' +
      'Thin red and blue printed stripes along the top, a few printed ruled lines, and handwritten black marker text: "LEVEL 0 - DO NOT TAPE OVER" and below it smaller "tape 3 of 5??". ' +
      'Slightly worn, yellowed paper with a small coffee ring stain. Legible text, no other text.',
  },
  {
    id: 'almond_label', kind: 'label', size: '1536x1024', quality: 'medium',
    prompt: 'Flat unwrapped product label for a plastic drink bottle, filling the entire frame edge to edge, no bottle, no background, front-on print design. ' +
      'Brand name in large friendly retro lettering: "ALMOND WATER". Under it: "refreshing - calming - probably safe". A simple illustration of an almond and a water drop. ' +
      'Small side text: "Est. Level 0" and "500 mL". Cream white background, soft brown and pale blue colour scheme. Legible text, no other text.',
  },
  {
    id: 'logo', kind: 'logo', size: '1536x1024', transparent: true,
    prompt: 'Pixel art video game title logo text reading exactly "LEVEL 0": the word LEVEL, then a clearly visible wide gap, then the digit zero drawn narrower than a letter O with a diagonal slash through it so it reads as a number. In the style of the Minecraft title logo: big chunky blocky 3D pixel letters with a stone-like texture, ' +
      'coloured sickly yellow and beige like old office wallpaper, thick dark outline and a darker extruded side for depth, a faint flicker glow. ' +
      'Hard edged large square pixels, no anti-aliasing. Transparent background, only the logo, no other text.',
  },
];

function run(job, force) {
  const out = join(RAW, `${job.id}.png`);
  if (existsSync(out) && !force) return Promise.resolve({ id: job.id, skipped: true });
  const args = [GEN, job.prompt, out, `--size=${job.size}`];
  if (job.quality) args.push(`--quality=${job.quality}`);
  if (job.transparent) args.push('--transparent');
  if (job.model) args.push(`--model=${job.model}`);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.on('close', (code) => {
      const res = { id: job.id, code, ...(code === 0 ? JSON.parse(buf) : {}) };
      appendFileSync(join(RAW, 'log.jsonl'), JSON.stringify({ ...res, at: new Date().toISOString() }) + '\n');
      resolve(res);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const conc = Number((argv.find((a) => a.startsWith('--jobs=')) || '--jobs=4').split('=')[1]);
  const ids = argv.filter((a) => !a.startsWith('--'));
  const todo = JOBS.filter((j) => !ids.length || ids.includes(j.id) || ids.includes(j.kind));
  mkdirSync(RAW, { recursive: true });
  const queue = [...todo];
  await Promise.all(Array.from({ length: conc }, async () => {
    while (queue.length) {
      const r = await run(queue.shift(), force);
      console.log(JSON.stringify(r));
    }
  }));
}
