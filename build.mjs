// Inlines the stylesheet, scripts and font into one self-contained HTML file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const font = readFileSync(join(here, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')).toString('base64');
const parts = {
  '/*__FONT__*/': font,
  '/*__CSS__*/': read('src/styles.css'),
  '/*__CORE__*/': read('src/core.js'),
  '/*__APP__*/': read('src/app.js')
};

let html = read('src/index.html');
for (const [mark, text] of Object.entries(parts)) {
  if (!html.includes(mark)) throw new Error('missing placeholder ' + mark);
  if (/<\/script/i.test(text) && mark !== '/*__CSS__*/' && mark !== '/*__FONT__*/') throw new Error('script text contains a closing script tag');
  html = html.replace(mark, () => text);
}

// docs/index.html is what GitHub Pages serves. It is also the whole tool: one file that works on its own.
mkdirSync(join(here, 'docs'), { recursive: true });
const out = join(here, 'docs/index.html');
writeFileSync(out, html);
writeFileSync(join(here, 'docs/.nojekyll'), '');
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
