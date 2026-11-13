// Writes the app's screens into dist/ so they can also be opened in a browser.
// Files are re-written (not copied) so dist/ always carries the build time.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src');
const out = path.join(__dirname, '..', 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) fs.writeFileSync(path.join(out, f), fs.readFileSync(path.join(src, f)));
console.log('Web build written to dist/');
