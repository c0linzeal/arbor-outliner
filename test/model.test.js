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

console.log('model tests passed');
