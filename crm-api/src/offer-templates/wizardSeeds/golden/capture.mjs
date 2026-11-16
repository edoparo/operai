// Regenerates every text.*.txt from the committed answers.*.json by driving the mockup in a
// browser. NOT part of the test run (needs the untracked mockup and Playwright); see README.md.
//
//   MOCKUP=/abs/path/WellD_OperAI_Wizard_Offerte.html node capture.mjs [--check]
//
// Run it with the working directory set to a folder holding `@playwright/test` (the repo's `shell/`).
// `--check` compares instead of writing and exits 1 on any difference.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mockup = process.env.MOCKUP;
if (!mockup) throw new Error('set MOCKUP to the absolute path of the mockup HTML');
const check = process.argv.includes('--check');
const { chromium } = createRequire(resolve('package.json'))('@playwright/test');

const files = [];
for (const dir of [here, join(here, 'variants')]) {
  for (const f of readdirSync(dir)) if (/^answers\..+\.json$/.test(f)) files.push([dir, f]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(pathToFileURL(mockup).href);
await page.waitForTimeout(1500);

let different = 0;
for (const [dir, f] of files) {
  const answers = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = await page.evaluate((answers) => {
    const w = window.OfferWizard;
    w.setData(answers);
    const missing = w.missing();
    w.goTo('fine');
    const sheet = document.querySelector('.sheet');
    if (!sheet) return { error: 'no preview sheet' };
    const flat = (n) =>
      n.nodeType === 3 ? n.textContent : n.nodeName === 'BR' ? ' / ' : [...n.childNodes].map(flat).join('');
    const txt = (el) => flat(el).replace(/[\s ]+/g, ' ').trim();
    const lines = [];
    for (const el of sheet.children) {
      if (el.tagName === 'IMG' || el.classList.contains('foot')) continue;
      if (el.tagName === 'TABLE') {
        for (const tr of el.querySelectorAll('tr')) {
          lines.push('| ' + [...tr.children].map(txt).join(' | ') + ' |');
        }
      } else if (el.tagName === 'UL' || el.tagName === 'OL') {
        const kind = el.tagName === 'UL' ? 'ul' : el.getAttribute('type') === 'a' ? 'al' : 'ol';
        [...el.children].forEach((li, i) =>
          lines.push((kind === 'ul' ? '- ' : kind === 'al' ? String.fromCharCode(97 + i) + '. ' : i + 1 + '. ') + txt(li)),
        );
      } else if (el.classList.contains('sigline')) lines.push(txt(el.querySelector('span')));
      else if (txt(el)) lines.push(txt(el));
    }
    return { lines, missing, marked: sheet.querySelectorAll('.miss').length };
  }, answers);
  if (r.error || r.missing.length || r.marked) {
    throw new Error(`${f}: incomplete answers (${r.error ?? JSON.stringify(r.missing)}, marked=${r.marked})`);
  }
  const out = join(dir, f.replace(/^answers\./, 'text.').replace(/\.json$/, '.txt'));
  const text = r.lines.join('\n') + '\n';
  if (check) {
    if (readFileSync(out, 'utf8') !== text) { different++; console.error('DIFFERENT', out); }
  } else writeFileSync(out, text);
}
await browser.close();
console.log(check ? (different ? `${different} different` : `${files.length} identical`) : `${files.length} written`);
process.exit(different ? 1 : 0);
