// Run: node test/model.test.js
const assert = require('assert');
const M = require('../src/model.js');

const names = rows => rows.map(r => r.text);
function sample() {
  const d = M.newDoc('Test');
  d.root.children = [M.row('A'), M.row('B'), M.row('C')];
  return d;
}

// indent / outdent / move
let d = sample();
const [a, b, c] = d.root.children;
M.indent(d, [b.id, c.id]);
assert.deepStrictEqual(names(d.root.children), ['A']);
assert.deepStrictEqual(names(a.children), ['B', 'C']);
M.outdent(d, [b.id, c.id]);
assert.deepStrictEqual(names(d.root.children), ['A', 'B', 'C']);
assert.strictEqual(M.moveUp(d, [a.id]), false);
M.moveDown(d, [a.id]);
assert.deepStrictEqual(names(d.root.children), ['B', 'A', 'C']);
M.moveTo(d, [c.id], b.id, 'inside');
assert.deepStrictEqual(names(b.children), ['C']);
assert.strictEqual(M.moveTo(d, [b.id], c.id, 'inside'), false, 'cannot drop a row into its own child');
M.duplicate(d, [b.id]);
assert.deepStrictEqual(names(d.root.children), ['B', 'B', 'A']);
assert.notStrictEqual(d.root.children[0].children[0].id, d.root.children[1].children[0].id);
M.deleteRows(d, d.root.children.map(r => r.id));
assert.strictEqual(d.root.children.length, 1, 'an outline always keeps one row');

// status checkboxes
d = sample(); M.indent(d, [d.root.children[1].id, d.root.children[2].id]);
const p = d.root.children[0];
p.children[0].state = true;
assert.strictEqual(M.statusOf(p), 'mixed');
M.setStatus(p, true);
assert.strictEqual(M.statusOf(p), 'checked');

// visible rows: collapse, focus, filter
p.collapsed = true;
assert.strictEqual(M.visibleRows(d).length, 1);
assert.strictEqual(M.visibleRows(d, { text: 'c' }).length, 2, 'filter shows matches with their parents');
assert.strictEqual(M.visibleRows(d, { focusId: p.id }).length, 3);
p.children[0].state = false;
assert.deepStrictEqual(M.visibleRows(d, { status: 'unchecked' }).map(v => v.row.text), ['A', 'B']);

// durations and summaries
assert.strictEqual(M.parseDuration('1d 2h 30m'), 10.5);
assert.strictEqual(M.parseDuration('1w'), 40);
assert.strictEqual(M.formatDuration(10.5), '1d 2h 30m');
const num = M.column('Cost', 'number', { summary: 'sum' });
d.columns.push(num);
p.children[0].values[num.id] = 2.5; p.children[1].values[num.id] = 4;
assert.deepStrictEqual(M.cellValue(d, p, num), { value: 6.5, computed: true });
num.summary = 'avg'; assert.strictEqual(M.cellValue(d, p, num).value, 3.25);
num.summary = 'max'; assert.strictEqual(M.cellValue(d, p, num).value, 4);
const dt = M.column('Due', 'date', { summary: 'min' }); d.columns.push(dt);
p.children[0].values[dt.id] = '2026-05-02'; p.children[1].values[dt.id] = '2026-01-09';
assert.strictEqual(M.cellValue(d, p, dt).value, '2026-01-09');
const cb = M.column('Done', 'checkbox', { summary: 'state' }); d.columns.push(cb);
M.setCheckboxCell(p, cb, true);
assert.strictEqual(M.cellValue(d, p, cb).value, true);
p.children[0].values[cb.id] = false;
assert.strictEqual(M.cellValue(d, p, cb).value, 'mixed');

// sorting and column conversion
M.sortChildren(d, p, num.id, -1);
assert.deepStrictEqual(names(p.children), ['C', 'B']);
M.sortChildren(d, p, null, 1);
assert.deepStrictEqual(names(p.children), ['B', 'C']);
M.convertColumn(d, num, 'text');
assert.strictEqual(p.children[0].values[num.id], '2.5');

// numbering
assert.strictEqual(M.prefix('outline', [2]), 'II.');
assert.strictEqual(M.prefix('outline', [2, 3]), 'C.');
assert.strictEqual(M.prefix('decimal', [1, 2, 3]), '1.2.3');
assert.strictEqual(M.prefix('outline', [1, 1, 1, 28]), 'ab.');

// styles
const s = M.resolveStyle(d, Object.assign(M.row('x'), { named: ['done'], style: { italic: true } }), 0);
assert.ok(s.bold && s.strike && s.italic);
assert.ok(M.styleCss(s).includes('line-through'));

// OPML round trip keeps hierarchy, notes, status and typed columns
d = M.fromTemplate('project');
d.root.children[0].note = 'Line 1\nLine "2" & <3>';
d.root.children[0].children[0].state = true;
let back = M.fromOPML(M.toOPML(d));
assert.deepStrictEqual(M.allRows(back).map(r => r.text), M.allRows(d).map(r => r.text));
assert.strictEqual(back.root.children[0].note, d.root.children[0].note);
assert.strictEqual(back.root.children[0].children[0].state, true);
assert.deepStrictEqual(back.columns.map(c => c.type), ['text', 'date', 'duration', 'popup']);

// Markdown and text round trips
d.root.children[1].note = 'Remember this';
back = M.fromMarkdown(M.toMarkdown(d));
assert.deepStrictEqual(M.allRows(back).map(r => r.text), M.allRows(d).map(r => r.text));
assert.strictEqual(back.root.children[1].note, 'Remember this');
assert.strictEqual(back.root.children[0].children[0].state, true);
back = M.fromText(M.toText(d));
assert.deepStrictEqual(M.allRows(back).map(r => r.text), M.allRows(d).map(r => r.text));
const md = M.fromMarkdown('# Title\nIntro para\n## Sub\n- one\n  - two\n- three\n');
assert.deepStrictEqual(M.allRows(md).map(r => r.text), ['Title', 'Sub', 'one', 'two', 'three']);
assert.strictEqual(md.root.children[0].note, 'Intro para');

// CSV / HTML exports
d = M.fromTemplate('budget');
const csv = M.toCSV(d);
assert.ok(csv.startsWith('Level,Topic,Amount,Category,Note'));
assert.ok(csv.includes('1,Home,1350,,'), 'parent row shows the summed amount');
assert.ok(M.toHTML(d).includes('<table>'));
assert.ok(M.toHTML(M.fromTemplate('essay')).includes('II.'));

// normalize fills gaps in hand-written files
const n = M.normalize({ title: 'X', root: { children: [{ text: 'hi' }] } });
assert.strictEqual(n.root.children[0].children.length, 0);
assert.ok(n.styles.named.length);

// column conditions in filters
d = M.fromTemplate('project');
const [owner, due, est, pri] = d.columns;
const shown = rules => M.visibleRows(d, { rules }).map(v => v.row.text);
d.root.children[0].children[0].values[pri.id] = 'High';
assert.deepStrictEqual(shown([{ col: pri.id, op: 'is', value: 'high' }]), ['Plan', 'Define goals'], 'pop-up value, with its parent row');
d.root.children[1].children[1].values[owner.id] = 'Yuki';
assert.deepStrictEqual(shown([{ col: owner.id, op: 'contains', value: 'yu' }]), ['Build', 'Review']);
assert.deepStrictEqual(shown([{ col: owner.id, op: 'filled' }, { col: pri.id, op: 'is', value: 'High' }]), [], 'every condition must match');
d.root.children[2].children[0].values[est.id] = 16;
assert.deepStrictEqual(shown([{ col: est.id, op: 'gt', value: '1d' }]), ['Launch', 'Announce'], 'durations compare as time; parent total 2d also matches');
d.root.children[0].children[1].values[due.id] = '2000-01-01';
assert.ok(shown([{ col: due.id, op: 'past' }]).includes('Agree scope'));
assert.deepStrictEqual(shown([{ col: due.id, op: 'before', value: '2001-01-01' }]), ['Plan', 'Agree scope']);
assert.strictEqual(shown([{ col: 'gone', op: 'is', value: 'x' }]).length, M.visibleRows(d).length, 'a rule for a deleted column is ignored');

// Office exports are valid zip packages; RTF reads back as the same outline
const O = require('../src/office.js');
const zipNames = buf => { const out = []; for (let i = 0; i < buf.length - 4; i++) if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 1 && buf[i + 3] === 2) { const n = buf[i + 28] | buf[i + 29] << 8; out.push(Buffer.from(buf.slice(i + 46, i + 46 + n)).toString()); } return out; };
assert.ok(zipNames(O.toXLSX(d)).includes('xl/worksheets/sheet1.xml'));
assert.ok(zipNames(O.toDOCX(d)).includes('word/document.xml'));
assert.ok(zipNames(O.toPPTX(d)).includes(`ppt/slides/slide${d.root.children.length + 1}.xml`), 'a title slide plus one per top-level row');
assert.strictEqual(O.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
d = M.fromTemplate('essay'); d.statusVisible = true; d.numbering = 'none';
d.root.children[0].note = 'Opening "line"'; d.root.children[1].children[0].state = true; d.root.children[2].text = 'Conclusión {final} \\ 終わり';
back = O.fromRTF(O.toRTF(d), 'x');
assert.deepStrictEqual(M.allRows(back).map(r => r.text), M.allRows(d).map(r => r.text));
assert.strictEqual(back.title, 'Essay Outline');
assert.strictEqual(back.root.children[0].note, 'Opening "line"');
assert.strictEqual(back.root.children[1].children[0].state, true);

// focusing on several sections at once
d = M.fromTemplate('project');
const [plan, build, launch] = d.root.children;
assert.deepStrictEqual(M.visibleRows(d, { focusIds: [launch.id, plan.id] }).map(v => v.row.text + v.depth),
  ['Plan0', 'Define goals1', 'Agree scope1', 'Launch0', 'Announce1'], 'focused sections in outline order');
assert.deepStrictEqual(M.visibleRows(d, { focusIds: [plan.id, plan.children[0].id] }).length, 3, 'a row inside another focused row is not shown twice');
M.outdent(d, [launch.children[0].id], [plan.id, launch.id]);
assert.strictEqual(launch.children.length, 1, 'rows stay inside a focused section when moved left');

// Word and PowerPoint import (Arbor's own exports, re-packed with deflate as Office does)
const deflateZip = require('./deflate-zip.js');
(async () => {
  const p = M.fromTemplate('project');
  p.root.children[0].note = 'Kick-off'; p.root.children[0].children[0].state = true;
  const w = await O.fromDOCX(deflateZip(O.toDOCX(p)), 'x');
  assert.strictEqual(w.title, 'Project Plan');
  assert.deepStrictEqual(M.allRows(w).map(r => r.text), M.allRows(p).map(r => r.text));
  assert.deepStrictEqual(w.columns.map(c => c.name + ':' + c.type), ['Owner:text', 'Due:text', 'Estimate:duration', 'Priority:text']);
  assert.strictEqual(w.root.children[0].note, 'Kick-off');
  assert.strictEqual(w.root.children[0].children[0].state, true);
  const e = M.fromTemplate('essay'); e.root.children[1].note = 'Three points';
  const we = await O.fromDOCX(deflateZip(O.toDOCX(e)), 'x');
  assert.deepStrictEqual(M.allRows(we).map(r => r.text), M.allRows(e).map(r => r.text), 'numbered paragraphs');
  assert.strictEqual(we.root.children[1].note, 'Three points');
  const s = await O.fromPPTX(deflateZip(O.toPPTX(p)), 'x');
  assert.strictEqual(s.title, 'Project Plan', 'the cover slide gives the title');
  assert.deepStrictEqual(M.allRows(s).map(r => r.text), M.allRows(p).map(r => r.text), 'one row per slide, bullets inside');
  assert.strictEqual(s.root.children[0].note, 'Kick-off');
  assert.strictEqual(s.root.children[0].children[0].state, true);
  await assert.rejects(O.fromDOCX(new Uint8Array(100), 'x'), /not an Office document/);
  console.log('model tests passed');
})().catch(err => { console.error(err); process.exit(1); });
