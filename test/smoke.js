// End-to-end check of the real app window: `npx electron . --smoke`
// Drives the outline with real keystrokes and checks the result after each step.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clipboard } = require('electron');

module.exports = async ({ createWindow, app, wins }) => {
  const results = []; let failed = 0;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const win = createWindow();
  const wc = win.webContents;
  const pageErrors = [];
  wc.on('console-message', e => { if (e.level === 'error') pageErrors.push(e.message); });
  await new Promise(r => wc.once('did-finish-load', r));
  win.show(); win.focus(); wc.focus();
  await wait(400);

  const js = code => wc.executeJavaScript(code);
  const A = 'window.__arbor';
  const key = async (keyCode, ...modifiers) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(80);
  };
  const type = async t => { await wc.insertText(t); await wait(80); };
  const tree = () => js(`JSON.stringify(${A}.state.doc.root.children.map(function f(r){ return r.text + (r.children.length ? '[' + r.children.map(f).join(',') + ']' : ''); }))`);
  const rowCount = () => js(`document.querySelectorAll('#rows .row').length`);
  // Click-like focus: puts the text cursor at the end of the row.
  const focusTopic = async text => {
    await js(`{ const t = [...document.querySelectorAll('#rows .topic')].find(t => t.textContent === ${JSON.stringify(text)});
      t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }`);
    await wait(60);
  };
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const check = async (name, fn) => {
    try { await fn(); results.push('PASS  ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + ': ' + e.message); }
  };

  await check('starts with an empty row ready for typing', async () => {
    eq(await js(`document.activeElement.className`), 'topic', 'focused element');
  });
  await check('typing, Enter for new rows, Tab to indent', async () => {
    await type('Groceries'); await key('Enter'); await type('Milk'); await key('Tab'); await key('Enter'); await type('Bread');
    eq(JSON.parse(await tree()), ['Groceries[Milk,Bread]'], 'outline');
  });
  await check('Shift+Tab moves a row left', async () => {
    await key('Tab', 'shift');
    eq(JSON.parse(await tree()), ['Groceries[Milk]', 'Bread'], 'outline');
  });
  await check('Ctrl+Z undoes and Ctrl+Y redoes', async () => {
    await key('Z', 'control');
    eq(JSON.parse(await tree()), ['Groceries[Milk,Bread]'], 'after undo');
    await key('Y', 'control');
    eq(JSON.parse(await tree()), ['Groceries[Milk]', 'Bread'], 'after redo');
  });
  await check('Ctrl+Enter checks a row', async () => {
    await focusTopic('Bread'); await key('Enter', 'control');
    eq(await js(`${A}.state.doc.root.children[1].state`), true, 'Bread checked');
    eq(await js(`document.querySelectorAll('#rows .status')[2].checked`), true, 'checkbox drawn');
  });
  await check('parent checkbox shows mixed when some children are checked', async () => {
    await focusTopic('Milk'); await key('Enter'); await type('Eggs'); await key('Enter', 'control');
    eq(await js(`document.querySelectorAll('#rows .status')[0].indeterminate`), true, 'Groceries mixed');
  });
  await check('Ctrl+Shift+Up moves a row up', async () => {
    await focusTopic('Bread'); await key('Up', 'control', 'shift');
    eq(JSON.parse(await tree()), ['Bread', 'Groceries[Milk,Eggs]'], 'outline');
  });
  await check('Alt+Left collapses and Alt+Right expands', async () => {
    await focusTopic('Groceries'); await key('Left', 'alt');
    eq(await rowCount(), 2, 'rows while collapsed');
    await key('Right', 'alt');
    eq(await rowCount(), 4, 'rows after expanding');
  });
  await check("Ctrl+' adds a note", async () => {
    await focusTopic('Groceries'); await key("'", 'control');
    eq(await js(`document.activeElement.className`), 'note', 'note focused');
    await type('Buy oat milk');
    eq(await js(`${A}.state.doc.root.children[1].note`), 'Buy oat milk', 'note text');
    await key('Escape');
    eq(await js(`document.activeElement.className`), 'topic', 'back on the row');
  });
  await check('Ctrl+B makes a row bold', async () => {
    await key('B', 'control');
    eq(await js(`getComputedStyle([...document.querySelectorAll('#rows .topic')][1]).fontWeight`), '700', 'font weight');
  });
  await check('number column totals the rows inside', async () => {
    await js(`${A}.run('addColumn:number')`); await wait(100);
    for (const [row, v] of [['Milk', '2.5'], ['Eggs', '4']]) {
      await js(`[...document.querySelectorAll('#rows .row')].find(r => r.querySelector('.topic').textContent === ${JSON.stringify(row)}).querySelector('.cell[data-col] [contenteditable]').focus()`);
      await type(v); await key('Enter'); await wait(120);
    }
    eq(await js(`[...document.querySelectorAll('#rows .row')].find(r => r.querySelector('.topic').textContent === 'Groceries').querySelector('.cell.computed').textContent`), '6.5', 'Groceries total');
  });
  await check('filter shows matching rows with their parents', async () => {
    await js(`{ const f = document.getElementById('filter'); f.value = 'egg'; f.dispatchEvent(new Event('input')); }`); await wait(80);
    eq(await rowCount(), 2, 'filtered rows');
    await js(`{ const f = document.getElementById('filter'); f.value = ''; f.dispatchEvent(new Event('input')); }`); await wait(80);
    eq(await rowCount(), 4, 'rows after clearing');
  });
  await check('Ctrl+Shift+F focuses on a section', async () => {
    await focusTopic('Groceries'); await key('F', 'control', 'shift');
    eq(await js(`document.getElementById('focusbar').hidden`), false, 'focus bar shown');
    eq(await rowCount(), 3, 'rows in focus');
    await js(`${A}.run('unfocus')`); await wait(60);
    eq(await rowCount(), 4, 'rows after unfocus');
  });
  await check('find and replace all', async () => {
    await key('H', 'control');
    await js(`document.getElementById('findText').value = 'Eggs'; document.getElementById('findText').dispatchEvent(new Event('input')); document.getElementById('replaceText').value = 'Free-range eggs'`);
    await wait(60);
    eq(await js(`document.getElementById('findCount').textContent`), '1 of 1', 'match count');
    await js(`${A}.run('replaceAll')`); await wait(60);
    eq(JSON.parse(await tree()), ['Bread', 'Groceries[Milk,Free-range eggs]'], 'outline');
    await js(`${A}.run('closeFind')`);
  });
  await check('Esc selects rows, Shift+Down extends, Delete removes, undo restores', async () => {
    await focusTopic('Milk'); await key('Escape');
    eq(await js(`document.activeElement.id`), 'outline', 'selection mode');
    await key('Down', 'shift');
    eq(await js(`${A}.state.sel.size`), 2, 'rows selected');
    await key('Delete');
    eq(JSON.parse(await tree()), ['Bread', 'Groceries'], 'after delete');
    await key('Z', 'control');
    eq(JSON.parse(await tree()), ['Bread', 'Groceries[Milk,Free-range eggs]'], 'after undo');
  });
  await check('copy and paste rows', async () => {
    await focusTopic('Bread'); await key('Escape');
    wc.copy(); await wait(150);
    eq(await clipboard.readText(), 'Bread', 'clipboard text');
    wc.paste(); await wait(150);
    eq(JSON.parse(await tree()), ['Bread', 'Bread', 'Groceries[Milk,Free-range eggs]'], 'after paste');
    await key('Delete');
  });
  await check('pasting several lines into a row makes several rows', async () => {
    clipboard.writeText('Apples\n\tGreen\nPears');
    await focusTopic('Bread'); await key('Enter'); wc.paste(); await wait(150);
    eq(JSON.parse(await tree()), ['Bread', 'Apples[Green]', 'Pears', 'Groceries[Milk,Free-range eggs]'], 'after paste');
  });
  await check('Backspace in an empty row deletes it', async () => {
    await focusTopic('Pears'); await key('Enter'); await key('Backspace');
    eq(JSON.parse(await tree()), ['Bread', 'Apples[Green]', 'Pears', 'Groceries[Milk,Free-range eggs]'], 'outline');
    eq(await js(`document.activeElement.textContent`), 'Pears', 'cursor back on the previous row');
  });
  const tmp = path.join(os.tmpdir(), `arbor-smoke-${Date.now()}.arbor`);
  await check('save writes a file and opening it brings everything back', async () => {
    await js(`${A}.state.path = ${JSON.stringify(tmp)}; ${A}.save()`); await wait(200);
    const saved = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    eq(saved.root.children.map(r => r.text), ['Bread', 'Apples', 'Pears', 'Groceries'], 'saved rows');
    eq(await js(`${A}.state.dirty`), false, 'not dirty after save');
    await js(`${A}.setDoc(${A}.M.newDoc(), null)`);
    await js(`${A}.loadContent(${JSON.stringify(tmp)}, ${JSON.stringify(fs.readFileSync(tmp, 'utf8'))})`); await wait(100);
    eq(JSON.parse(await tree()), ['Bread', 'Apples[Green]', 'Pears', 'Groceries[Milk,Free-range eggs]'], 'reopened outline');
    eq(await js(`${A}.state.doc.root.children[3].note`), 'Buy oat milk', 'note kept');
    eq(await js(`${A}.state.doc.columns[0].type`), 'number', 'column kept');
  });
  await check('edits save automatically once the file has a name', async () => {
    await focusTopic('Pears'); await type(' and plums'); await wait(1700);
    eq(JSON.parse(fs.readFileSync(tmp, 'utf8')).root.children[2].text, 'Pears and plums', 'autosaved text');
  });
  await check('OPML, Markdown and text exports read back the same rows', async () => {
    const ok = await js(`(() => { const M = ${A}.M, d = ${A}.state.doc, t = x => M.allRows(x).map(r => r.text).join('|');
      return [M.fromOPML(M.toOPML(d)), M.fromMarkdown(M.toMarkdown(d)), M.fromText(M.toText(d))].every(x => t(x) === t(d)); })()`);
    eq(ok, true, 'round trips');
  });
  await check('templates: budget totals each section', async () => {
    await js(`${A}.setDoc(${A}.M.fromTemplate('budget'), null)`); await wait(100);
    eq(await js(`[...document.querySelectorAll('#rows .row')][0].querySelector('.cell.computed').textContent`), '1350', 'Home total');
    eq(await js(`document.querySelectorAll('#rows select').length > 0`), true, 'pop-up list cells');
  });
  await check('numbering, themes and dark appearance', async () => {
    await js(`${A}.run('numbering:outline'); ${A}.run('appearance:dark'); ${A}.run('theme:paper')`); await wait(60);
    eq(await js(`document.querySelector('#rows .prefix').textContent`), 'I.', 'first prefix');
    eq(await js(`document.body.classList.contains('dark') && document.body.classList.contains('theme-paper')`), true, 'theme classes');
  });
  await check('automation scripts can change the outline', async () => {
    const out = await js(`${A}.runScript("const r = outline.add('From script'); outline.add('Child', r); console.log(outline.rows().length)")`);
    eq(out.trim(), '10', 'script output (8 budget rows + 2)');
    eq(await js(`[...document.querySelectorAll('#rows .topic')].some(t => t.textContent === 'From script')`), true, 'row drawn');
  });
  await check('distraction-free mode hides the panels', async () => {
    await js(`${A}.run('toggleZen')`); await wait(300);
    eq(await js(`getComputedStyle(document.getElementById('toolbar')).display`), 'none', 'toolbar hidden');
    await js(`${A}.run('toggleZen')`); await wait(300);
  });
  await check('inspector tabs all draw', async () => {
    for (const tab of ['document', 'style', 'columns', 'row']) {
      await js(`${A}.state.inspectorTab = '${tab}'; ${A}.run('toggleInspector'); ${A}.run('toggleInspector')`);
      const n = await js(`document.querySelectorAll('#inspector .pane *').length`);
      if (n < 1) throw new Error(tab + ' tab is empty');
    }
  });
  await check('filter by column value, saved and edited from the sidebar', async () => {
    await js(`${A}.setDoc(${A}.M.fromTemplate('project'), null)`); await wait(100);
    await js(`{ const d = ${A}.state.doc, pri = d.columns[3]; d.root.children[1].children[0].values[pri.id] = 'High';
      ${A}.state.filter = { text: '', status: 'all', rules: [] }; }`);
    await js(`${A}.run('filterEditor')`); await wait(100);
    await js(`[...document.querySelectorAll('#modal button')].find(b => b.textContent === '+ Add condition').click()`); await wait(60);
    await js(`{ const [col, op] = document.querySelectorAll('#modal .rule select'); col.value = ${A}.state.doc.columns[3].id; col.dispatchEvent(new Event('change')); }`); await wait(60);
    await js(`{ const v = document.querySelectorAll('#modal .rule select')[2]; v.value = 'High'; v.dispatchEvent(new Event('change'));
      const n = document.querySelector('#modal .form input:last-of-type'); const name = [...document.querySelectorAll('#modal .form input')].pop(); name.value = 'Urgent'; name.dispatchEvent(new Event('input')); }`);
    await js(`document.querySelector('#modal .actions button:last-child').click()`); await wait(120);
    eq(JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#rows .topic')].map(t => t.textContent))`)), ['Build', 'First draft'], 'filtered rows');
    eq(await js(`${A}.state.doc.filters.map(f => f.name).join()`), 'Urgent', 'saved filter');
    eq(await js(`[...document.querySelectorAll('#sidebar .item.active')].some(i => i.textContent.startsWith('Urgent'))`), true, 'sidebar shows it active');
    await js(`${A}.run('clearFilter')`); await wait(60);
    eq(await rowCount(), 8, 'all rows back');
  });
  await check('find lists every match in the sidebar', async () => {
    await key('F', 'control');
    await js(`{ const f = document.getElementById('findText'); f.value = 'e'; f.dispatchEvent(new Event('input')); }`); await wait(100);
    const n = await js(`${A}.state.find.matches.length`);
    eq(await js(`document.querySelectorAll('#sidebar .item.result').length`), n, 'one sidebar entry per match');
    await js(`document.querySelectorAll('#sidebar .item.result')[2].click()`); await wait(80);
    eq(await js(`${A}.state.find.idx`), 2, 'clicking a result goes to it');
    eq(await js(`document.getElementById('findCount').textContent`), `3 of ${n}`, 'count');
    await js(`${A}.run('closeFind')`); await wait(60);
    eq(await js(`document.querySelectorAll('#sidebar .item.result').length`), 0, 'results gone when find closes');
  });
  await check('folded editing and typewriter scrolling', async () => {
    await js(`${A}.state.doc.root.children[0].text = 'A very long row '.repeat(30); ${A}.state.folded = false; ${A}.state.typewriter = false; ${A}.run('toggleFolded')`); await wait(60);
    await js(`${A}.setDoc(${A}.state.doc, null)`); await wait(60);
    eq(await js(`document.body.classList.contains('folded')`), true, 'folded class');
    eq(await js(`getComputedStyle(document.querySelectorAll('#rows .topic')[0]).textWrapMode`), 'nowrap', 'rows not being edited fold to one line');
    await js(`${A}.run('toggleFolded'); ${A}.run('toggleTypewriter')`); await wait(60);
    await focusTopic('Announce'); await type('!'); await wait(120);
    const off = await js(`(() => { const o = document.getElementById('outline').getBoundingClientRect(), r = document.activeElement.getBoundingClientRect(); return Math.abs((r.top + r.height / 2) - (o.top + o.height * 0.45)); })()`);
    if (off > 30) throw new Error('caret line is ' + Math.round(off) + 'px from the middle');
    await js(`${A}.run('toggleTypewriter')`);
  });
  await check('custom keyboard shortcut replaces the built-in one', async () => {
    await js(`window.api.setShortcuts({ bold: 'Ctrl+Alt+B' })`); await wait(150);
    eq(await js(`'Ctrl+b' in ${A}.state.shortcuts || Object.keys(${A}.state.shortcuts).join()`), 'bold', 'override received');
    const { Menu } = require('electron');
    const bold = Menu.getApplicationMenu().items.find(m => m.label === 'F&ormat').submenu.items.find(i => i.label === 'Bold');
    eq(bold.accelerator, 'Ctrl+Alt+B', 'menu shows the new keys');
    eq(JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#rows .topic')].map(t => t.textContent).slice(-2))`)), ['Launch', 'Announce!'], 'rows');
    await focusTopic('Announce!'); await key('B', 'control');
    eq(await js(`!!${A}.state.doc.root.children[2].children[0].style.bold`), false, 'old keys do nothing');
    bold.click(); await wait(80);
    eq(await js(`!!${A}.state.doc.root.children[2].children[0].style.bold`), true, 'the command still works');
    await js(`window.api.setShortcuts({})`); await wait(150);
    eq(await js(`${A}.keyName({ code: 'KeyB', key: 'B', ctrlKey: true, shiftKey: true, altKey: false })`), 'Ctrl+Shift+B', 'key names');
    eq(await js(`${A}.accelToKey('Ctrl+Shift+Up') + ' ' + ${A}.keyToAccel('Ctrl+Alt+ArrowLeft')`), 'Ctrl+Shift+ArrowUp Ctrl+Alt+Left', 'key conversions');
  });
  await check('shortcut editor draws every menu command', async () => {
    await js(`${A}.run('shortcuts')`); await wait(200);
    const n = await js(`document.querySelectorAll('#modal table.keys tr').length`);
    if (n < 60) throw new Error('only ' + n + ' commands listed');
    await key('Escape'); await wait(60);
    eq(await js(`document.getElementById('modal').hidden`), true, 'closes with Esc');
  });
  await check('images resize by dragging the corner', async () => {
    const img = path.join(__dirname, '..', 'assets', 'icon.png');
    await js(`${A}.state.doc.root.children[0].attachments.push({ name: 'icon.png', path: ${JSON.stringify(img)} }); ${A}.setDoc(${A}.state.doc, null)`); await wait(200);
    await js(`document.querySelector('.chip.image').scrollIntoView({ block: 'center' })`); await wait(60);
    const box = JSON.parse(await js(`JSON.stringify(document.querySelector('.chip.image .resize').getBoundingClientRect())`));
    const x = Math.round(box.x + 5), y = Math.round(box.y + 5);
    eq(await js(`document.elementFromPoint(${x}, ${y}).className`), 'resize', 'corner under the pointer');
    wc.sendInputEvent({ type: 'mouseMove', x, y }); await wait(30);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await wait(30);
    wc.sendInputEvent({ type: 'mouseMove', x: x + 120, y, button: 'left' }); await wait(30);
    wc.sendInputEvent({ type: 'mouseUp', x: x + 120, y, button: 'left', clickCount: 1 }); await wait(100);
    const w = await js(`${A}.state.doc.root.children[0].attachments[0].width`);
    if (!(w > 100)) throw new Error('width after drag: ' + w);
  });
  await check('audio recording attaches a playable file to the row', async () => {
    await js(`document.querySelector('#rows .topic').focus()`); await key('Escape');
    await js(`${A}.run('record')`); await wait(1800);
    eq(await js(`!!document.querySelector('#statusbar .rec')`), true, 'recording shown');
    await js(`${A}.run('record')`); await wait(900);
    const att = JSON.parse(await js(`JSON.stringify(${A}.state.doc.root.children[0].attachments.slice(-1)[0] || null)`));
    if (!att || !/\.webm$/.test(att.path) || !fs.existsSync(att.path) || fs.statSync(att.path).size < 500) throw new Error('recording: ' + JSON.stringify(att));
    eq(await js(`!!document.querySelector('.chip.audio audio')`), true, 'player shown');
    fs.unlinkSync(att.path);
  });
  const opml = path.join(os.tmpdir(), `arbor-smoke-${Date.now()}.opml`);
  await check('OPML mode: an .opml file is edited and saved as OPML', async () => {
    fs.writeFileSync(opml, '<?xml version="1.0"?><opml version="2.0"><head><title>Trip</title></head><body><outline text="Pack"><outline text="Passport"/></outline></body></opml>');
    await js(`${A}.loadContent(${JSON.stringify(opml)}, ${JSON.stringify(fs.readFileSync(opml, 'utf8'))})`); await wait(100);
    eq(await js(`${A}.state.path`), opml, 'kept its path');
    eq(await js(`document.querySelector('#statusbar .badge').textContent`), 'OPML', 'badge');
    await focusTopic('Passport'); await type(' and tickets'); await wait(1700);
    const saved = fs.readFileSync(opml, 'utf8');
    if (!saved.includes('<outline text="Passport and tickets"/>') || !saved.startsWith('<?xml')) throw new Error(saved.slice(0, 300));
  });
  await check('a second window on the same outline shows changes from the first', async () => {
    await js(`${A}.run('mirrorWindow')`); await wait(900);
    const other = [...wins.values()].find(s => s.win !== win).win.webContents;
    eq(await other.executeJavaScript(`${A}.state.doc.root.children[0].children[0].text`), 'Passport and tickets', 'opened with the outline');
    await focusTopic('Pack'); await type(' bags'); await wait(500);
    eq(await other.executeJavaScript(`${A}.state.doc.root.children[0].text`), 'Pack bags', 'change arrived');
    await other.executeJavaScript(`${A}.state.doc.root.children[0].text = 'Pack bags now'; ${A}.run('markDirty'); window.api.syncDoc(JSON.stringify(${A}.state.doc))`); await wait(400);
    eq(await js(`${A}.state.doc.root.children[0].text`), 'Pack bags now', 'and back again');
    other.close(); await wait(300);
    eq(await js(`document.getElementById('statusbar').textContent.includes('another window')`), false, 'on its own again');
    eq(await js(`document.getElementById('statusbar').textContent.includes('null')`), false, 'status bar text');
  });
  await check('focus on several sections: selected rows, then Ctrl+click in the sidebar', async () => {
    await js(`${A}.setDoc(${A}.M.fromTemplate('project'), null)`); await wait(100);
    await js(`{ const k = ${A}.state.doc.root.children; ${A}.state.sel = new Set([k[0].id, k[2].id]); ${A}.run('focus'); }`); await wait(80);
    eq(await rowCount(), 5, 'Plan and Launch with their rows');
    eq(await js(`document.getElementById('focusbar').textContent.startsWith('Focused on 2 sections: Plan, Launch')`), true, 'focus bar');
    const click = (label, ctrl) => js(`[...document.querySelectorAll('#sidebar .item')].find(i => i.textContent === ${JSON.stringify(label)})
      .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ${ctrl} }))`);
    await click('Build', true); await wait(80);
    eq(await rowCount(), 8, 'Ctrl+click adds Build');
    eq(await js(`[...document.querySelectorAll('#sidebar .item.active')].map(i => i.textContent).filter(t => ['Plan', 'Build', 'Launch'].includes(t)).length`), 3, 'all three marked in the sidebar');
    await click('Plan', true); await wait(80);
    eq(JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#rows .topic')].map(t => t.textContent))`)), ['Build', 'First draft', 'Review', 'Launch', 'Announce'], 'Ctrl+click again takes Plan out');
    await click('Plan', false); await wait(80);
    eq(await rowCount(), 3, 'a plain click focuses on just that section');
    await js(`${A}.run('unfocus')`); await wait(60);
    eq(await rowCount(), 8, 'whole outline again');
  });
  const docx = path.join(os.tmpdir(), `arbor-smoke-${Date.now()}.docx`);
  await check('opening a Word document turns its headings and lists into rows', async () => {
    const O = require('../src/office.js'), M = require('../src/model.js');
    const src = M.fromTemplate('essay'); src.root.children[0].note = 'Start strong';
    fs.writeFileSync(docx, require('./deflate-zip.js')(O.toDOCX(src)));
    const w2 = createWindow(docx); await new Promise(r => w2.webContents.once('did-finish-load', r)); await wait(600);
    const got = JSON.parse(await w2.webContents.executeJavaScript(`JSON.stringify({ rows: ${A}.M.allRows(${A}.state.doc).map(r => r.text), note: ${A}.state.doc.root.children[0].note, path: ${A}.state.path, title: ${A}.state.doc.title })`));
    eq(got.rows, M.allRows(src).map(r => r.text), 'rows');
    eq(got.note, 'Start strong', 'note');
    eq(got.path, null, 'imported as a new, unsaved outline');
    eq(got.title, 'Essay Outline', 'title');
    w2.destroy(); await wait(200);
  });
  await check('new window opens', async () => {
    await js(`${A}.run('newDoc')`); await wait(800);
    eq(wins.size, 2, 'window count');
  });
  await check('no errors in the page', async () => { eq(pageErrors, [], 'console errors'); });

  if (process.env.SMOKE_SHOT) { // optional screenshots for a visual check
    await js(`${A}.setDoc(${A}.M.fromTemplate('project'), null); ${A}.state.doc.root.children[0].note = 'Kick-off on Monday'; ${A}.run('numbering:none')`);
    await wait(300);
    fs.writeFileSync(process.env.SMOKE_SHOT + '-light.png', (await wc.capturePage()).toPNG());
    await js(`${A}.run('appearance:dark'); ${A}.run('theme:ocean'); ${A}.state.inspectorTab = 'style'; ${A}.run('toggleInspector'); ${A}.run('toggleInspector')`);
    await wait(300);
    fs.writeFileSync(process.env.SMOKE_SHOT + '-dark.png', (await wc.capturePage()).toPNG());
    await js(`${A}.run('appearance:light'); ${A}.run('theme:standard'); ${A}.run('filterEditor')`); await wait(200);
    await js(`[...document.querySelectorAll('#modal button')].find(b => b.textContent === '+ Add condition').click()`); await wait(200);
    fs.writeFileSync(process.env.SMOKE_SHOT + '-filter.png', (await wc.capturePage()).toPNG());
    await key('Escape'); await js(`${A}.run('shortcuts')`); await wait(300);
    fs.writeFileSync(process.env.SMOKE_SHOT + '-keys.png', (await wc.capturePage()).toPNG());
    await key('Escape'); await key('F', 'control');
    await js(`{ const f = document.getElementById('findText'); f.value = 'e'; f.dispatchEvent(new Event('input')); }`); await wait(200);
    fs.writeFileSync(process.env.SMOKE_SHOT + '-find.png', (await wc.capturePage()).toPNG());
  }
  for (const f of [tmp, opml, docx]) try { fs.unlinkSync(f); } catch { /* already gone */ }
  console.log('\n' + results.join('\n') + `\n\n${results.length - failed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
};
