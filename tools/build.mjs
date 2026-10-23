// Builds the bookmarklet from bookmarklet/launcher.js.
//
//   node tools/build.mjs              writes bookmarklet/bookmarklet.txt
//   node tools/build.mjs --site DIR   also renders docs/index.html into DIR
//
// Needs terser: npm install --no-save terser
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { minify } from 'terser';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const source = read('bookmarklet/launcher.js');
const version = (source.match(/VERSION = '([\d.]+)'/) || [])[1];
if (!version) throw new Error("VERSION = 'x.y.z' not found in launcher.js");

const { code } = await minify(source, { compress: true, mangle: true });
const bookmarklet = 'javascript:' + code;
writeFileSync(new URL('bookmarklet/bookmarklet.txt', root), bookmarklet + '\n');
console.log(`bookmarklet v${version}: ${bookmarklet.length} chars`);

const siteIndex = process.argv.indexOf('--site');
if (siteIndex > 0) {
    const dir = new URL(process.argv[siteIndex + 1].replace(/\/?$/, '/'), `file://${process.cwd()}/`);
    const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // A javascript: URL is percent-decoded before it runs, so a literal % must be escaped.
    const href = html(bookmarklet.replace(/%/g, '%25'));
    const page = read('docs/index.html')
        .replaceAll('{{VERSION}}', version)
        .replaceAll('{{HREF}}', href)
        .replaceAll('{{CODE}}', html(bookmarklet));
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('index.html', dir), page);
    console.log(`page written to ${dir.pathname}index.html`);
}
