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
  }
  try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  console.log('\n' + results.join('\n') + `\n\n${results.length - failed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
};
