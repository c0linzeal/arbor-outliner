'use strict';
/* global Model */
const M = window.Model;
const host = window.api || webShim();
const $ = s => document.querySelector(s);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') value = v;
    else if (k in el && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  if (value !== undefined) el.value = value;
  return el;
}

const state = {
  doc: M.newDoc(), path: null, dirty: false, pristine: true, version: 0,
  sel: new Set(), anchor: null, head: null, focusId: null, filter: { text: '', status: 'all', rules: [] },
  undo: [], redo: [], editing: false, pendingFocus: null, noteOpen: new Set(), clip: null, drag: null,
  sidebar: true, inspector: true, zen: false, inspectorTab: 'document', flashCol: null,
  find: { idx: -1, matches: [] },
  folded: pref('folded', false), typewriter: pref('typewriter', false),
  recording: null, mirrored: false, shortcuts: {},
};
// Per-person view settings kept between sessions.
function pref(k, dflt) { try { const v = localStorage.getItem('arbor.' + k); return v === null ? dflt : JSON.parse(v); } catch { return dflt; } }
function setPref(k, v) { try { localStorage.setItem('arbor.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
const isOPML = () => !!state.path && /\.opml$/i.test(state.path);
const THEMES = [['standard', 'Standard'], ['paper', 'Paper'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['mono', 'Mono']];
const TYPE_NAMES = { text: 'Text', number: 'Number', duration: 'Duration', date: 'Date', checkbox: 'Checkbox', popup: 'Pop-up list' };
const SUMMARY_NAMES = { none: 'None', sum: 'Total', avg: 'Average', min: 'Minimum', max: 'Maximum', hidden: 'Hide on parent rows', state: 'Checked when all are checked' };

// ---------------------------------------------------------------- changes & undo
const snapshot = () => JSON.stringify(state.doc);
function pushUndo(s) { state.undo.push(s); if (state.undo.length > 300) state.undo.shift(); state.redo = []; }
function beginEdit() { if (!state.editing) { pushUndo(snapshot()); state.editing = true; } }
function endEdit() { state.editing = false; }
function change(fn) { endEdit(); pushUndo(snapshot()); fn(state.doc); touched(); render(); }
function viewChange(fn) { fn(state.doc); touched(); render(); }
let lastDirty = null;
function touched() {
  state.version++; state.dirty = true; state.pristine = false;
  if (lastDirty !== true) { host.setDirty(true); lastDirty = true; }
  updateTitle(); renderStatus(); scheduleAutosave(); scheduleSync();
}
// Other windows on the same outline get every change shortly after it happens.
let syncTimer;
function scheduleSync() { if (!state.mirrored || !host.syncDoc) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => host.syncDoc(JSON.stringify(state.doc)), 150); }
function receiveSync(json) {
  clearTimeout(syncTimer);
  state.mirrored = true; state.editing = false;
  state.doc = JSON.parse(json); state.version++;
  render();
}
function undo() {
  if (!state.undo.length) return;
  state.editing = false; state.redo.push(snapshot());
  state.doc = JSON.parse(state.undo.pop()); touched(); render();
}
function redo() {
  if (!state.redo.length) return;
  state.editing = false; state.undo.push(snapshot());
  state.doc = JSON.parse(state.redo.pop()); touched(); render();
}

// ---------------------------------------------------------------- selection & focus
const rowEls = () => [...document.querySelectorAll('#rows .row')];
const rowElById = id => document.querySelector(`#rows .row[data-id="${id}"]`);
function activeRowId() { const a = document.activeElement; const el = a && a.closest && a.closest('#rows .row'); return el ? el.dataset.id : null; }
function targets() {
  const ids = state.sel.size ? [...state.sel] : (activeRowId() ? [activeRowId()] : []);
  const order = new Map(M.allRows(state.doc).map((r, i) => [r.id, i]));
  return ids.filter(id => order.has(id)).sort((a, b) => order.get(a) - order.get(b));
}
function paintSelection() { for (const el of rowEls()) el.classList.toggle('selected', state.sel.has(el.dataset.id)); }
function selectOnly(id) {
  state.sel = new Set(id ? [id] : []); state.anchor = state.head = id;
  paintSelection(); if (state.inspectorTab === 'row') renderInspector();
}
function selectRange(toId) {
  const ids = rowEls().map(e => e.dataset.id);
  let a = ids.indexOf(state.anchor); const b = ids.indexOf(toId);
  if (a < 0) { a = b; state.anchor = toId; }
  state.head = toId;
  state.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
  paintSelection(); if (state.inspectorTab === 'row') renderInspector();
}
function isTyping() { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
function enterSelection() {
  const id = activeRowId();
  if (document.activeElement) document.activeElement.blur();
  $('#outline').focus({ preventScroll: true });
  if (id && !state.sel.has(id)) selectOnly(id);
}
function getCaret(el) {
  const s = getSelection();
  if (!s.rangeCount || !el.contains(s.anchorNode)) return null;
  const r = document.createRange(); r.selectNodeContents(el); r.setEnd(s.anchorNode, s.anchorOffset);
  return r.toString().length;
}
function setCaret(el, pos) {
  el.focus();
  if (!el.isContentEditable) return;
  const r = document.createRange();
  r.selectNodeContents(el); r.collapse(pos === 'start');
  if (typeof pos === 'number') {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, left = pos;
    while ((n = w.nextNode())) { if (left <= n.length) { r.setStart(n, left); r.collapse(true); break; } left -= n.length; }
  }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function captureFocus() {
  const a = document.activeElement; const row = a && a.closest && a.closest('#rows .row');
  if (!row) return null;
  if (a.classList.contains('topic')) return { id: row.dataset.id, field: 'topic', caret: getCaret(a) };
  if (a.classList.contains('note')) return { id: row.dataset.id, field: 'note', caret: getCaret(a) };
  const cell = a.closest('.cell[data-col]');
  return cell ? { id: row.dataset.id, field: 'cell', col: cell.dataset.col } : null;
}
function restoreFocus(f) {
  const row = rowElById(f.id); if (!row) return;
  let el;
  if (f.field === 'cell') { const cell = row.querySelector(`.cell[data-col="${f.col}"]`); el = cell && cell.querySelector('[contenteditable],input,select'); }
  else el = row.querySelector(f.field === 'note' ? '.note' : '.topic');
  if (el) setCaret(el, f.caret == null ? 'end' : f.caret);
}
function focusField(id, field = 'topic', caret = 'end') { restoreFocus({ id, field, caret }); }
const readText = el => el.innerText.replace(/\n$/, '');

// ---------------------------------------------------------------- rendering
const mq = matchMedia('(prefers-color-scheme: dark)');
mq.addEventListener('change', () => applyTheme());
function applyTheme() {
  const d = state.doc, b = document.body;
  for (const c of [...b.classList]) if (c.startsWith('theme-')) b.classList.remove(c);
  b.classList.add('theme-' + d.theme);
  b.classList.toggle('dark', d.appearance === 'dark' || (d.appearance === 'system' && mq.matches));
  b.classList.toggle('no-sidebar', !state.sidebar);
  b.classList.toggle('no-inspector', !state.inspector);
  b.classList.toggle('zen', state.zen);
  b.classList.toggle('folded', state.folded);
  b.classList.toggle('typewriter', state.typewriter);
}
function render() { applyTheme(); renderOutline(); renderSidebar(); renderInspector(); renderStatus(); updateTitle(); }
const visibleCols = () => state.doc.columns.filter(c => !c.hidden);
const gridTemplate = cols => ['minmax(180px, 1fr)'].concat(cols.map(c => c.width + 'px')).join(' ');
const activeRules = () => (state.filter.rules || []).filter(r => state.doc.columns.some(c => c.id === r.col));
const filtering = () => !!state.filter.text.trim() || state.filter.status !== 'all' || activeRules().length > 0;
const visibleOpts = () => ({ focusId: state.focusId, text: state.filter.text, status: state.filter.status, rules: state.filter.rules });

function renderOutline() {
  const d = state.doc;
  const keep = state.pendingFocus || captureFocus(); state.pendingFocus = null;
  const cols = visibleCols();
  $('#outline').style.setProperty('--cols', gridTemplate(cols));
  const header = $('#header');
  header.hidden = !cols.length;
  header.replaceChildren(h('div', {}, 'Topic'), ...cols.map(headerCell));
  if (state.focusId && !M.find(d, state.focusId)) state.focusId = null;
  const fb = $('#focusbar'), fr = state.focusId && M.find(d, state.focusId).row;
  fb.hidden = !fr;
  if (fr) fb.replaceChildren(h('span', {}, 'Focused on: ' + (fr.text || 'Untitled row')), h('button', { onclick: () => cmd.unfocus() }, 'Show entire outline'));
  const vis = M.visibleRows(d, visibleOpts());
  $('#filterBtn').classList.toggle('on', activeRules().length > 0);
  const paths = M.numberPaths(d);
  const rows = $('#rows');
  rows.replaceChildren(...vis.map(v => rowEl(v.row, v.depth, cols, paths)));
  if (!vis.length) rows.append(h('div', { class: 'empty' }, 'No rows match the filter.'));
  if (keep) restoreFocus(keep);
  highlightFind();
}

function headerCell(c) {
  const el = h('div', { title: 'Click to edit this column, drag the edge to resize', onclick: () => showColumn(c.id) }, c.name);
  const grip = h('span', { class: 'grip', onclick: e => e.stopPropagation() });
  grip.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = c.width; grip.setPointerCapture(e.pointerId);
    const move = ev => { c.width = Math.max(50, Math.round(w0 + ev.clientX - x0)); $('#outline').style.setProperty('--cols', gridTemplate(visibleCols())); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); touched(); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  el.append(grip);
  return el;
}
function showColumn(id) {
  state.inspector = true; state.inspectorTab = 'columns'; state.flashCol = id;
  applyTheme(); renderInspector();
}

function rowEl(r, depth, cols, paths) {
  const d = state.doc;
  const status = M.statusOf(r), kids = r.children.length > 0;
  const el = h('div', { class: 'row' + (state.sel.has(r.id) ? ' selected' : '') + (d.statusVisible && status === 'checked' ? ' checked' : ''), 'data-id': r.id });
  const handle = h('span', { class: 'handle' + (kids ? (r.collapsed ? ' collapsed' : ' expanded') : ''), draggable: true,
    title: kids ? 'Click to expand or collapse. Drag to move.' : 'Drag to move' });
  const topic = h('div', { class: 'topic', contentEditable: 'plaintext-only', spellcheck: true });
  topic.textContent = r.text;
  topic.style.cssText = M.styleCss(M.resolveStyle(d, r, paths.get(r.id).length - 1));
  const tc = h('div', { class: 'cell topic-cell', style: { paddingLeft: (8 + depth * 22) + 'px' } }, handle);
  if (d.statusVisible) {
    const cb = h('input', { type: 'checkbox', class: 'status', title: 'Checkbox (Ctrl+Enter)' });
    cb.checked = status === 'checked'; cb.indeterminate = status === 'mixed';
    cb.addEventListener('change', () => change(() => M.setStatus(r, status !== 'checked')));
    tc.append(cb);
  }
  if (d.numbering !== 'none') tc.append(h('span', { class: 'prefix' }, M.prefix(d.numbering, paths.get(r.id))));
  tc.append(topic);
  el.append(h('div', { class: 'cells' }, tc, ...cols.map(c => cellEl(r, c))));
  const indentPx = 8 + depth * 22 + 20 + (d.statusVisible ? 18 : 0);
  if (d.notesVisible && (r.note || state.noteOpen.has(r.id))) el.append(noteEl(r, indentPx));
  if (r.attachments.length) el.append(attachmentsEl(r, indentPx));
  wireRow(el, r, handle, topic);
  return el;
}

function noteEl(r, pad) {
  const n = h('div', { class: 'note', contentEditable: 'plaintext-only', spellcheck: true, style: { paddingLeft: pad + 'px' } });
  n.textContent = r.note;
  n.addEventListener('focus', () => { if (!state.sel.has(r.id) || state.sel.size > 1) selectOnly(r.id); });
  n.addEventListener('input', () => { beginEdit(); r.note = readText(n); touched(); });
  n.addEventListener('blur', () => {
    endEdit();
    if (!r.note.trim()) { r.note = ''; state.noteOpen.delete(r.id); setTimeout(() => { if (document.activeElement !== n) n.remove(); }); }
  });
  return n;
}

const fileUrl = p => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i, AUDIO_RE = /\.(webm|ogg|oga|mp3|m4a|wav|flac|aac)$/i;
function attachmentsEl(r, pad) {
  return h('div', { class: 'attachments', style: { paddingLeft: pad + 'px' } }, r.attachments.map((a, i) => {
    if (AUDIO_RE.test(a.path)) {
      return h('span', { class: 'chip audio', title: a.path },
        h('audio', { controls: true, preload: 'metadata', src: fileUrl(a.path) }),
        h('span', { class: 'aname', title: 'Open in another app', onclick: () => host.openPath(a.path) }, a.name.replace(/\.[^.]+$/, '')));
    }
    if (!IMAGE_RE.test(a.path)) return h('span', { class: 'chip', title: a.path + '\nClick to open', onclick: () => host.openPath(a.path) }, '\u{1F4CE} ' + a.name);
    // Images show inline at the size they were last given; drag the corner to resize.
    const img = h('img', { src: fileUrl(a.path), alt: a.name, draggable: false });
    if (a.width) img.style.width = a.width + 'px';
    const chip = h('span', { class: 'chip image' + (a.width ? ' sized' : ''), title: a.path + '\nDouble-click to open. Drag the corner to resize.', ondblclick: () => host.openPath(a.path) }, img);
    const grip = h('span', { class: 'resize', title: 'Drag to resize. Double-click for the original size.' });
    grip.addEventListener('dblclick', e => { e.stopPropagation(); change(d => { delete M.find(d, r.id).row.attachments[i].width; }); });
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = img.getBoundingClientRect().width / (parseFloat(getComputedStyle(document.body).zoom) || 1);
      const max = Math.max(80, $('#outline').clientWidth - pad - 40);
      const size = ev => Math.round(Math.min(max, Math.max(40, w0 + ev.clientX - x0)));
      const move = ev => { img.style.width = size(ev) + 'px'; chip.classList.add('sized'); };
      const up = ev => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
        const w = size(ev); change(d => { M.find(d, r.id).row.attachments[i].width = w; });
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
    chip.append(grip);
    return chip;
  }));
}

function cellEl(r, col) {
  const cv = M.cellValue(state.doc, r, col);
  const cell = h('div', { class: 'cell c-' + col.type + (cv.computed ? ' computed' : ''), 'data-col': col.id });
  const commit = v => {
    const old = r.values[col.id];
    if (old === v || (old === undefined && v === undefined)) return;
    change(() => { if (v === undefined) delete r.values[col.id]; else r.values[col.id] = v; });
  };
  if (col.type === 'checkbox') {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = cv.value === true; cb.indeterminate = cv.value === 'mixed';
    cb.addEventListener('change', () => change(() => M.setCheckboxCell(r, col, cv.value !== true)));
    cell.append(cb); return cell;
  }
  if (cv.computed) { cell.textContent = M.formatValue(col, cv.value); cell.title = SUMMARY_NAMES[col.summary] + ' of the rows inside'; return cell; }
  if (col.type === 'date') {
    cell.append(h('input', { type: 'date', class: cv.value ? '' : 'empty', value: cv.value || '', onchange: e => commit(e.target.value || undefined) }));
  } else if (col.type === 'popup') {
    const opts = col.options.slice();
    if (cv.value && !opts.includes(cv.value)) opts.push(cv.value);
    cell.append(h('select', { value: cv.value || '', onchange: e => commit(e.target.value || undefined) },
      h('option', { value: '' }, ''), opts.map(o => h('option', { value: o }, o))));
  } else {
    const ed = h('div', { contentEditable: 'plaintext-only', spellcheck: col.type === 'text' });
    ed.textContent = M.formatValue(col, cv.value);
    ed.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ed.blur(); } });
    ed.addEventListener('focus', () => { if (!state.sel.has(r.id)) selectOnly(r.id); });
    // Deferred so a click on another cell keeps its focus through the re-render.
    ed.addEventListener('blur', () => setTimeout(() => commit(M.parseValue(col, readText(ed).trim()))));
    cell.append(ed);
  }
  return cell;
}

function clearDrop() { for (const el of document.querySelectorAll('.drop-before,.drop-after,.drop-inside')) el.classList.remove('drop-before', 'drop-after', 'drop-inside'); }
const urlIn = t => (t.match(/\b(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/i) || [])[0];

function wireRow(el, r, handle, topic) {
  handle.addEventListener('click', e => { if (r.children.length) { e.stopPropagation(); viewChange(() => { r.collapsed = !r.collapsed; }); } });
  handle.addEventListener('dragstart', e => {
    if (!state.sel.has(r.id)) selectOnly(r.id);
    state.drag = targets();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', M.rowsToText(state.drag.map(id => M.find(state.doc, id).row)));
  });
  handle.addEventListener('dragend', () => { state.drag = null; clearDrop(); });
  el.addEventListener('dragover', e => {
    const files = !state.drag && e.dataTransfer.types.includes('Files');
    if (!state.drag && !files) return;
    e.preventDefault(); e.stopPropagation(); clearDrop();
    const box = el.getBoundingClientRect(), y = (e.clientY - box.top) / box.height;
    const pos = files ? 'inside' : y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    el.classList.add('drop-' + pos); el.dataset.drop = pos;
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-before', 'drop-after', 'drop-inside'); });
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    const pos = el.dataset.drop; clearDrop();
    if (state.drag) { const ids = state.drag; state.drag = null; change(d => M.moveTo(d, ids, r.id, pos)); return; }
    const files = [...e.dataTransfer.files].map(f => ({ name: f.name, path: host.pathForFile(f) })).filter(f => f.path);
    if (files.length) change(() => r.attachments.push(...files));
  });
  el.addEventListener('mousedown', e => {
    const t = e.target;
    if (t.closest('input,select,.cell[data-col] [contenteditable],.chip')) return;
    const onTopic = t.closest('.topic,.note');
    if (e.shiftKey) { e.preventDefault(); enterSelection(); selectRange(r.id); return; }
    if (e.ctrlKey) {
      if (onTopic && urlIn(r.text)) return; // the click handler opens the link
      e.preventDefault(); enterSelection();
      if (state.sel.has(r.id)) state.sel.delete(r.id); else state.sel.add(r.id);
      state.anchor = r.id; paintSelection(); renderInspector(); return;
    }
    if (!onTopic) { e.preventDefault(); enterSelection(); selectOnly(r.id); }
  });
  topic.addEventListener('click', e => { if (e.ctrlKey) { const u = urlIn(r.text); if (u) { e.preventDefault(); host.openExternal(/^www\./i.test(u) ? 'https://' + u : u); } } });
  topic.addEventListener('focus', () => {
    if (!state.sel.has(r.id) || state.sel.size > 1) selectOnly(r.id);
    if (state.zen && !state.typewriter) topic.scrollIntoView({ block: 'center' });
  });
  topic.addEventListener('input', () => { beginEdit(); r.text = readText(topic); touched(); scheduleSidebar(); if (state.zen && !state.typewriter) topic.scrollIntoView({ block: 'center' }); });
  topic.addEventListener('blur', endEdit);
}
let sidebarTimer;
function scheduleSidebar() { clearTimeout(sidebarTimer); sidebarTimer = setTimeout(renderSidebar, 400); }

// ---------------------------------------------------------------- sidebar
function renderSidebar() {
  const d = state.doc, f = state.filter;
  const item = (label, active, onclick, cls = '', extra = null, style = '') =>
    h('div', { class: 'item ' + cls + (active ? ' active' : ''), title: label, onclick }, h('span', { style }, label), extra);
  const kids = [h('h4', {}, 'Outline'), item('Entire outline', !state.focusId, () => cmd.unfocus())];
  for (const r of d.root.children) {
    kids.push(item(r.text || 'Untitled row', state.focusId === r.id, () => focusOn(r.id)));
    for (const c of r.children) if (c.children.length) kids.push(item(c.text || 'Untitled row', state.focusId === c.id, () => focusOn(c.id), 'sub'));
  }
  const results = findResultsEl();
  if (results) kids.unshift(...results);
  kids.push(h('h4', {}, 'Filters'));
  const noRules = !activeRules().length;
  for (const [v, l] of [['all', 'All rows'], ['unchecked', 'Unchecked'], ['checked', 'Checked']]) kids.push(item(l, !f.text && noRules && f.status === v, () => setFilter('', v)));
  const sameRules = sf => JSON.stringify(sf.rules || []) === JSON.stringify(f.rules || []);
  d.filters.forEach((sf, i) => kids.push(item(sf.name, f.text === sf.text && f.status === sf.status && sameRules(sf), () => setFilter(sf.text, sf.status, sf.rules || []), '',
    h('span', { class: 'acts' },
      h('span', { class: 'x', title: 'Edit this filter', onclick: e => { e.stopPropagation(); filterEditor(i); } }, '✎'),
      h('span', { class: 'x', title: 'Delete this filter', onclick: e => { e.stopPropagation(); change(dd => dd.filters.splice(i, 1)); } }, '✕')))));
  if (filtering()) {
    const inp = h('input', { placeholder: 'Name this filter' });
    kids.push(h('div', { class: 'save-filter' }, inp, h('button', { onclick: () => {
      const name = inp.value.trim() || describeFilter(f);
      change(dd => dd.filters.push({ name, text: f.text, status: f.status, rules: JSON.parse(JSON.stringify(f.rules || [])) }));
    } }, 'Save')));
  }
  kids.push(h('div', { class: 'item more', onclick: () => filterEditor() }, h('span', {}, '+ Filter by column…')));
  kids.push(h('h4', {}, 'Styles'));
  for (const ns of d.styles.named) {
    const { fontSize, ...look } = ns;
    kids.push(item(ns.name, false, () => applyNamed(ns.id), '', null, M.styleCss(look)));
  }
  $('#sidebar').replaceChildren(...kids);
}
function focusOn(id) { state.focusId = id; render(); }
function setFilter(text, status, rules = []) {
  state.filter = { text, status, rules }; $('#filter').value = text; $('#statusFilter').value = status;
  renderOutline(); renderSidebar(); renderStatus();
}
function describeFilter(f) {
  const parts = [];
  if (f.text) parts.push(`"${f.text}"`);
  if (f.status !== 'all') parts.push(f.status === 'checked' ? 'Checked' : 'Unchecked');
  for (const r of f.rules || []) {
    const c = state.doc.columns.find(x => x.id === r.col); if (!c) continue;
    const op = M.RULE_OPS[c.type].find(o => o[0] === r.op);
    const label = r.op === 'next' ? `is in the next ${r.value} days` : op ? op[1] + (op[2] ? ' ' + r.value : '') : r.op;
    parts.push(`${c.name} ${label}`);
  }
  return parts.join(', ') || 'All rows';
}

// Saved filters and column conditions: text, checkbox state and any number of column rules.
function filterEditor(savedIndex) {
  const d = state.doc, saved = savedIndex !== undefined ? d.filters[savedIndex] : null;
  const f = JSON.parse(JSON.stringify(saved || state.filter));
  f.rules = f.rules || [];
  const name = h('input', { value: saved ? saved.name : '', placeholder: 'Name (to save it in the sidebar)' });
  const text = h('input', { value: f.text || '', placeholder: 'Rows containing this text' });
  const status = pick(f.status || 'all', [['all', 'Any'], ['unchecked', 'Unchecked'], ['checked', 'Checked']], v => { f.status = v; });
  const list = h('div', { class: 'rules' });
  const drawRules = () => list.replaceChildren(...f.rules.map((r, i) => {
    const col = d.columns.find(c => c.id === r.col) || d.columns[0];
    if (!col) return null;
    const ops = M.RULE_OPS[col.type];
    if (!ops.some(o => o[0] === r.op)) r.op = ops[0][0];
    const op = ops.find(o => o[0] === r.op);
    let val = null;
    if (op[2]) {
      if (col.type === 'popup') val = pick(r.value || col.options[0] || '', col.options.map(o => [o, o]), v => { r.value = v; });
      else if (col.type === 'date' && r.op !== 'next') val = h('input', { type: 'date', value: r.value || '', onchange: e => { r.value = e.target.value; } });
      else val = h('input', { type: col.type === 'number' || r.op === 'next' ? 'number' : 'text', value: r.value || '', placeholder: col.type === 'duration' ? 'e.g. 2h' : r.op === 'next' ? 'days' : '',
        oninput: e => { r.value = e.target.value; } });
      if (col.type === 'popup' && r.value === undefined) r.value = col.options[0] || '';
    }
    return h('div', { class: 'rule' },
      pick(col.id, d.columns.map(c => [c.id, c.name]), v => { r.col = v; r.value = ''; drawRules(); }),
      pick(r.op, ops.map(o => [o[0], o[1]]), v => { r.op = v; drawRules(); }),
      val || h('span', { class: 'spacer' }),
      h('button', { title: 'Remove this condition', onclick: () => { f.rules.splice(i, 1); drawRules(); } }, '✕'));
  }));
  drawRules();
  const read = () => ({ text: text.value, status: f.status || 'all', rules: f.rules.filter(r => d.columns.some(c => c.id === r.col)) });
  openModal(h('h3', {}, saved ? 'Edit filter' : 'Filter'),
    h('div', { class: 'form' },
      h('label', {}, 'Text'), text,
      h('label', {}, 'Checkbox'), status,
      h('label', {}, 'Columns'), h('div', {}, list,
        d.columns.length ? h('button', { onclick: () => { f.rules.push({ col: d.columns[0].id, op: M.RULE_OPS[d.columns[0].type][0][0], value: '' }); drawRules(); } }, '+ Add condition')
          : h('span', { class: 'hint' }, 'Add a column to the outline to filter by its values.')),
      h('label', {}, 'Name'), name),
    h('p', { class: 'hint' }, 'Rows that match every condition are shown, with the rows they sit inside.'),
    h('div', { class: 'actions' },
      saved ? h('button', { onclick: () => { change(dd => dd.filters.splice(savedIndex, 1)); closeModal(); } }, 'Delete') : null,
      h('span', { class: 'spacer' }),
      h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { onclick: () => {
        const nf = read(), nm = name.value.trim();
        if (saved) change(dd => { dd.filters[savedIndex] = { name: nm || describeFilter(nf), ...nf }; });
        else if (nm) change(dd => dd.filters.push({ name: nm, ...nf }));
        closeModal(); setFilter(nf.text, nf.status, nf.rules);
      } }, saved ? 'Save' : name.value ? 'Save and show' : 'Show'),
    ));
  name.addEventListener('input', () => { const b = $('#modal .actions button:last-child'); if (!saved) b.textContent = name.value.trim() ? 'Save and show' : 'Show'; });
  text.focus();
}
function applyNamed(id) {
  const ids = targets(); if (!ids.length) return;
  change(d => {
    const rows = ids.map(x => M.find(d, x).row); const on = !rows.every(r => r.named.includes(id));
    rows.forEach(r => { r.named = r.named.filter(n => n !== id); if (on) r.named.push(id); });
  });
}

// ---------------------------------------------------------------- inspector
const field = (label, ...ctrl) => h('div', { class: 'field' }, h('label', {}, label), ...ctrl);
const pick = (value, options, onchange) => h('select', { value, onchange: e => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
function tick(value, onchange, label) {
  const c = h('input', { type: 'checkbox', onchange: e => onchange(e.target.checked) }); c.checked = !!value;
  return h('label', {}, c, ' ' + label);
}
function colour(value, onchange) {
  return h('span', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } },
    h('input', { type: 'color', value: value || '#000000', onchange: e => onchange(e.target.value) }),
    h('button', { title: 'Use the default', onclick: () => onchange('') }, value ? '✕' : 'Default'));
}
// Style controls; update(fn) applies fn to every style object being edited.
function styleControls(s, update) {
  const tog = (k, label, css, title) => h('button', { class: s[k] ? 'on' : '', title, style: css, onclick: () => update(o => { if (s[k]) delete o[k]; else o[k] = true; }) }, label);
  const setOrClear = k => v => update(o => { if (v) o[k] = v; else delete o[k]; });
  return [
    h('div', { class: 'btns' }, tog('bold', 'B', { fontWeight: 700 }, 'Bold (Ctrl+B)'), tog('italic', 'I', { fontStyle: 'italic' }, 'Italic (Ctrl+I)'),
      tog('underline', 'U', { textDecoration: 'underline' }, 'Underline (Ctrl+U)'), tog('strike', 'S', { textDecoration: 'line-through' }, 'Strikethrough (Ctrl+Shift+X)')),
    field('Text color', colour(s.color, setOrClear('color'))),
    field('Highlight', colour(s.highlight, setOrClear('highlight'))),
    field('Size', h('input', { type: 'number', min: 0, max: 72, placeholder: 'Default', value: s.fontSize || '',
      onchange: e => { const n = +e.target.value; update(o => { if (n) o.fontSize = n; else delete o.fontSize; }); } })),
  ];
}
function renderInspector() {
  if (!state.inspector) return;
  const tabs = [['document', 'Document'], ['style', 'Style'], ['columns', 'Columns'], ['row', 'Row']];
  const panes = { document: docPane, style: stylePane, columns: columnsPane, row: rowPane };
  $('#inspector').replaceChildren(
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: state.inspectorTab === k ? 'on' : '', onclick: () => { state.inspectorTab = k; renderInspector(); } }, l))),
    h('div', { class: 'pane' }, panes[state.inspectorTab]()));
  const fl = state.flashCol && document.querySelector(`#inspector [data-colcard="${state.flashCol}"]`);
  if (fl) { fl.classList.add('flash'); fl.scrollIntoView({ block: 'nearest' }); state.flashCol = null; }
}
function docPane() {
  const d = state.doc, s = M.stats(d);
  return [
    h('h5', {}, 'Document'),
    field('Title', h('input', { value: d.title, onchange: e => change(dd => { dd.title = e.target.value; }) })),
    field('Theme', pick(d.theme, THEMES, v => change(dd => { dd.theme = v; }))),
    field('Appearance', pick(d.appearance, [['system', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']], v => change(dd => { dd.appearance = v; }))),
    field('Numbering', pick(d.numbering, [['none', 'None'], ['outline', 'I. A. 1. a.'], ['decimal', '1.1.1'], ['simple', '1. on each level']], v => change(dd => { dd.numbering = v; }))),
    field('', tick(d.statusVisible, v => change(dd => { dd.statusVisible = v; }), 'Show checkboxes')),
    field('', tick(d.notesVisible, v => change(dd => { dd.notesVisible = v; }), 'Show notes')),
    h('h5', {}, 'Statistics'),
    h('div', { class: 'hint' }, `${s.rows} rows, ${s.words} words, ${s.checked} of ${s.leaves} items checked.`),
    h('h5', {}, 'File'),
    h('div', { class: 'hint' }, state.path ? state.path + ' (saves automatically)' : 'Not saved yet. Press Ctrl+S to save.'),
  ];
}

function stylePane() {
  const st = state.doc.styles;
  const fonts = ['Segoe UI', 'Aptos', 'Calibri', 'Cambria', 'Georgia', 'Arial', 'Verdana', 'Times New Roman', 'Bahnschrift', 'Consolas'];
  if (!fonts.includes(st.base.fontFamily)) fonts.push(st.base.fontFamily);
  const lines = [['1.2', 'Tight'], ['1.45', 'Normal'], ['1.8', 'Relaxed'], ['2.2', 'Double']];
  if (!lines.some(l => +l[0] === st.base.lineHeight)) lines.push([String(st.base.lineHeight), String(st.base.lineHeight)]);
  return [
    h('h5', {}, 'Whole document'),
    field('Font', pick(st.base.fontFamily, fonts.map(f => [f, f]), v => change(d => { d.styles.base.fontFamily = v; }))),
    field('Size', h('input', { type: 'number', min: 8, max: 48, value: st.base.fontSize, onchange: e => change(d => { d.styles.base.fontSize = +e.target.value || 15; }) })),
    field('Line spacing', pick(String(st.base.lineHeight), lines, v => change(d => { d.styles.base.lineHeight = +v; }))),
    field('Text color', colour(st.base.color, v => change(d => { if (v) d.styles.base.color = v; else delete d.styles.base.color; }))),
    h('h5', {}, 'Level styles'),
    h('div', { class: 'hint' }, 'Applied to every row at that level.'),
    st.levels.map((lv, i) => h('div', { class: 'card' }, h('strong', {}, 'Level ' + (i + 1)),
      styleControls(lv, fn => change(d => fn(d.styles.levels[i]))))),
    h('div', { class: 'btns' },
      h('button', { onclick: () => change(d => d.styles.levels.push({})) }, 'Add level'),
      st.levels.length ? h('button', { onclick: () => change(d => d.styles.levels.pop()) }, 'Remove last level') : null),
    h('h5', {}, 'Named styles'),
    h('div', { class: 'hint' }, 'Apply from the sidebar or the Row tab.'),
    st.named.map(ns => h('div', { class: 'card' },
      field('Name', h('input', { value: ns.name, onchange: e => change(d => { d.styles.named.find(x => x.id === ns.id).name = e.target.value || 'Style'; }) })),
      styleControls(ns, fn => change(d => fn(d.styles.named.find(x => x.id === ns.id)))),
      h('div', { class: 'btns' },
        h('button', { onclick: () => applyNamed(ns.id) }, 'Apply to selection'),
        h('button', { onclick: () => change(d => {
          d.styles.named = d.styles.named.filter(x => x.id !== ns.id);
          M.walk(d.root, r => { r.named = r.named.filter(x => x !== ns.id); });
        }) }, 'Delete')))),
    h('button', { onclick: () => change(d => d.styles.named.push({ id: M.uid(), name: 'New style', bold: true })) }, 'New named style'),
  ];
}
function sortBy(colId, dir) {
  const id = targets()[0];
  change(d => {
    let parent = state.focusId ? M.find(d, state.focusId).row : d.root;
    if (id) { const f = M.find(d, id); parent = f.row.children.length ? f.row : f.parent; }
    M.sortChildren(d, parent, colId, dir);
  });
}
function columnsPane() {
  const d = state.doc;
  const sortBtns = colId => [h('button', { title: 'Sort ascending', onclick: () => sortBy(colId, 1) }, 'Sort ↑'), h('button', { title: 'Sort descending', onclick: () => sortBy(colId, -1) }, 'Sort ↓')];
  const newType = pick('text', Object.entries(TYPE_NAMES), () => {});
  const sumLabel = (c, s) => c.type === 'date' && s === 'min' ? 'Earliest' : c.type === 'date' && s === 'max' ? 'Latest' : SUMMARY_NAMES[s];
  return [
    h('div', { class: 'hint' }, 'Sorting orders the rows inside the selected row, or the selected row and its siblings if it has none.'),
    h('div', { class: 'card' }, h('strong', {}, 'Topic'), h('div', { class: 'btns' }, sortBtns(null))),
    d.columns.map((c, i) => h('div', { class: 'card', 'data-colcard': c.id },
      field('Name', h('input', { value: c.name, onchange: e => change(dd => { dd.columns[i].name = e.target.value || 'Column'; }) })),
      field('Type', pick(c.type, Object.entries(TYPE_NAMES), v => change(dd => M.convertColumn(dd, dd.columns[i], v)))),
      field('Summary', pick(c.summary, M.SUMMARIES[c.type].map(s => [s, sumLabel(c, s)]), v => change(dd => { dd.columns[i].summary = v; }))),
      c.type === 'popup' ? field('Choices', h('textarea', { placeholder: 'One choice per line', value: c.options.join('\n'),
        onchange: e => change(dd => { dd.columns[i].options = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); }) })) : null,
      field('Width', h('input', { type: 'number', min: 50, max: 800, value: c.width, onchange: e => change(dd => { dd.columns[i].width = Math.max(50, +e.target.value || 120); }) })),
      field('', tick(c.hidden, v => change(dd => { dd.columns[i].hidden = v; }), 'Hidden')),
      h('div', { class: 'btns' },
        sortBtns(c.id),
        h('button', { title: 'Move left', disabled: i === 0, onclick: () => change(dd => { const a = dd.columns; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }) }, '←'),
        h('button', { title: 'Move right', disabled: i === d.columns.length - 1, onclick: () => change(dd => { const a = dd.columns; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }) }, '→'),
        h('button', { onclick: () => { if (confirm(`Delete the column "${c.name}" and its values?`)) change(dd => { dd.columns.splice(i, 1); M.walk(dd.root, r => { delete r.values[c.id]; }); }); } }, 'Delete')))),
    h('h5', {}, 'Add a column'),
    h('div', { class: 'field' }, newType, h('button', { onclick: () => cmd.addColumn(newType.value) }, 'Add')),
  ];
}
function rowPane() {
  const ids = targets();
  if (!ids.length) return [h('p', { class: 'hint' }, 'Select a row to style it, add a note or attach files.')];
  const first = M.find(state.doc, ids[0]).row;
  const forSel = fn => change(d => ids.forEach(id => { const f = M.find(d, id); if (f) fn(f.row); }));
  return [
    h('h5', {}, ids.length > 1 ? `${ids.length} rows selected` : 'Row style'),
    styleControls(first.style, fn => forSel(r => fn(r.style))),
    h('button', { onclick: () => cmd.clearStyle() }, 'Clear row style'),
    h('h5', {}, 'Named styles'),
    state.doc.styles.named.map(ns => h('div', {}, tick(first.named.includes(ns.id), on => forSel(r => { r.named = r.named.filter(x => x !== ns.id); if (on) r.named.push(ns.id); }), ns.name))),
    h('h5', {}, 'Note'),
    h('button', { onclick: () => cmd.toggleNote() }, first.note ? 'Edit note' : 'Add note'),
    h('h5', {}, 'Attachments'),
    first.attachments.map((a, i) => h('div', { class: 'field' },
      h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.path }, a.name),
      h('button', { onclick: () => host.openPath(a.path) }, 'Open'),
      h('button', { onclick: () => change(d => M.find(d, first.id).row.attachments.splice(i, 1)) }, 'Remove'))),
    h('button', { onclick: async () => {
      const ps = await host.pickFiles();
      if (ps && ps.length) change(d => M.find(d, first.id).row.attachments.push(...ps.map(p => ({ name: p.split(/[\\/]/).pop(), path: p }))));
    } }, 'Attach files…'),
    h('div', { class: 'hint' }, 'You can also drag files from File Explorer onto a row.'),
    h('h5', {}, 'Link'),
    h('button', { onclick: () => cmd.copyLink() }, 'Copy link to this row'),
  ];
}

// ---------------------------------------------------------------- status bar & title
let flashMsg = '', flashTimer;
function flash(msg) { flashMsg = msg; renderStatus(); clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashMsg = ''; renderStatus(); }, 2500); }
function renderStatus() {
  const s = M.stats(state.doc), parts = [`${s.rows} rows`, `${s.words} words`];
  if (state.doc.statusVisible) parts.push(`${s.checked} of ${s.leaves} checked`);
  if (state.focusId) parts.push('Focused');
  if (filtering()) parts.push('Filtered: ' + describeFilter(state.filter));
  if (state.mirrored) parts.push('Shown in another window');
  const saved = flashMsg || (state.path ? (state.dirty ? 'Saving…' : 'Saved') : state.pristine ? '' : 'Not saved yet');
  const rec = state.recording;
  $('#statusbar').replaceChildren(...[...parts.map(p => h('span', {}, p)),
    rec ? h('button', { class: 'rec', title: 'Stop recording (Ctrl+Shift+R)', onclick: () => cmd.record() }, `● Recording ${clock(rec.seconds)}  Stop`) : null,
    isOPML() ? h('span', { class: 'badge', title: 'This outline is saved as OPML. Rows, notes, checkboxes and columns are kept; styles are not.' }, 'OPML') : null,
    h('span', { class: 'right' }, saved)].filter(Boolean));
  $('#recordBtn').classList.toggle('on', !!rec);
  if (state.zen) $('#zenStats').textContent = `${s.words} words · ${s.rows} rows`;
}
const clock = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const baseName = p => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
function fileBase() { return state.path ? baseName(state.path) : (state.doc.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-'); }
function updateTitle() {
  const name = state.path ? baseName(state.path) : state.doc.title || 'Untitled';
  document.title = (state.dirty && !state.path ? '• ' : '') + name + ' - Arbor Outliner';
  $('#docTitle').textContent = name;
}

// ---------------------------------------------------------------- files
let saveTimer;
function scheduleAutosave() { if (!state.path || host.web) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 1200); }
async function save(as = false) {
  clearTimeout(saveTimer);
  let p = state.path;
  if (as || !p) { p = await host.saveDialog(fileBase() + (isOPML() ? '.opml' : '.arbor'), 'save'); if (!p) return false; }
  const v = state.version;
  // OPML mode: an .opml file is edited and saved as OPML, so other outliners can keep using it.
  try { await host.writeFile(p, /\.opml$/i.test(p) ? M.toOPML(state.doc) : JSON.stringify(state.doc, null, 1)); }
  catch (e) { alert('Could not save the outline.\n\n' + (e.message || e)); return false; }
  if (state.path !== p) { state.path = p; host.setPath(p); }
  state.dirty = state.version !== v; state.pristine = false;
  if (!state.dirty) { host.setDirty(false); lastDirty = false; }
  updateTitle(); renderStatus(); if (state.inspectorTab === 'document') renderInspector();
  return true;
}
function setDoc(doc, path) {
  Object.assign(state, { doc, path, undo: [], redo: [], sel: new Set(), focusId: null, filter: { text: '', status: 'all', rules: [] },
    noteOpen: new Set(), dirty: false, pristine: !path, editing: false });
  $('#filter').value = ''; $('#statusFilter').value = 'all';
  host.setDirty(false); lastDirty = false; host.setPath(path);
  render(); focusFirst();
}
function loadContent(path, content) {
  const ext = (path.split('.').pop() || '').toLowerCase(), name = baseName(path);
  let doc, native = false;
  try {
    if (ext === 'arbor' || ext === 'json') { doc = M.normalize(JSON.parse(content)); native = true; }
    else if (ext === 'opml') { doc = M.normalize(M.fromOPML(content)); native = !importing; }
    else if (ext === 'xml') doc = M.fromOPML(content);
    else if (ext === 'md' || ext === 'markdown') doc = M.fromMarkdown(content, name);
    else if (ext === 'rtf') doc = Office.fromRTF(content, name);
    else doc = M.fromText(content, name);
  } catch (e) { alert(`Could not open ${name}.\n\n${e.message}`); return; }
  if (!doc.title || doc.title === 'Untitled') doc.title = name;
  setDoc(doc, native && !host.web ? path : null);
  if (!native) { state.pristine = false; touched(); }
}
let importing = false; // File > Import makes a new, unsaved outline even from an .opml file
function openContent(path, content) { if (state.pristine || host.web) loadContent(path, content); else host.openInNewWindow(path); }
const Office = window.Office;
const EXPORTS = { opml: ['opml', M.toOPML], markdown: ['md', M.toMarkdown], text: ['txt', M.toText], html: ['html', M.toHTML], csv: ['csv', M.toCSV],
  rtf: ['rtf', Office.toRTF], xlsx: ['xlsx', Office.toXLSX], docx: ['docx', Office.toDOCX], pptx: ['pptx', Office.toPPTX] };
async function exportAs(kind) {
  if (kind === 'pdf') { const p = await host.exportPDF(fileBase() + '.pdf'); if (p) flash('Exported PDF'); return; }
  const [ext, fn] = EXPORTS[kind];
  const p = await host.saveDialog(fileBase() + '.' + ext, ext);
  if (!p) return;
  try { await host.writeFile(p, fn(state.doc)); flash('Exported ' + ext.toUpperCase()); }
  catch (e) { alert('Could not export.\n\n' + (e.message || e)); }
}
function focusFirst() { const t = document.querySelector('#rows .topic'); if (t && !t.textContent && rowEls().length === 1) setCaret(t, 'end'); }

// ---------------------------------------------------------------- find & replace
function findMatches() {
  const q = $('#findText').value; if (!q) return [];
  const cs = $('#findCase').checked, needle = cs ? q : q.toLowerCase(), out = [];
  M.walk(state.doc.root, r => {
    for (const fld of ['text', 'note']) {
      const hay = cs ? r[fld] : r[fld].toLowerCase();
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push({ id: r.id, field: fld, index: i, length: q.length });
    }
  });
  return out;
}
function findGo(dir, exact) {
  const ms = state.find.matches = findMatches();
  if (!ms.length) { state.find.idx = -1; $('#findCount').textContent = $('#findText').value ? 'No matches' : ''; highlightFind(); renderSidebar(); return; }
  state.find.idx = exact !== undefined ? exact : state.find.idx < 0 && dir < 0 ? ms.length - 1 : (state.find.idx + dir + ms.length) % ms.length;
  const m = ms[state.find.idx];
  reveal(m.id, m.field);
  $('#findCount').textContent = `${state.find.idx + 1} of ${ms.length}`;
}
// Batch find: every match listed in the sidebar with its surrounding words; click one to go there.
function findResultsEl() {
  const q = $('#findText').value;
  if ($('#findbar').hidden || !q) return null;
  const ms = state.find.matches, out = [h('h4', {}, `Find results (${ms.length})`)];
  if (!ms.length) out.push(h('div', { class: 'item muted' }, h('span', {}, 'No matches')));
  ms.slice(0, 300).forEach((m, i) => {
    const r = M.find(state.doc, m.id); if (!r) return;
    const t = r.row[m.field], a = Math.max(0, m.index - 24), b = Math.min(t.length, m.index + m.length + 40);
    const before = (a ? '…' : '') + t.slice(a, m.index), hit = t.slice(m.index, m.index + m.length), after = t.slice(m.index + m.length, b) + (b < t.length ? '…' : '');
    out.push(h('div', { class: 'item result' + (i === state.find.idx ? ' active' : ''), title: (m.field === 'note' ? 'In the note of: ' : '') + (r.row.text || 'Untitled row'),
      onclick: () => findGo(0, i) },
      h('span', {}, m.field === 'note' ? h('em', { class: 'tag' }, 'note') : null, before.replace(/\n/g, ' '), h('mark', {}, hit), after.replace(/\n/g, ' '))));
  });
  if (ms.length > 300) out.push(h('div', { class: 'item muted' }, h('span', {}, `and ${ms.length - 300} more`)));
  return out;
}
function reveal(id, fld = 'topic') {
  const d = state.doc; if (!M.find(d, id)) return;
  const anc = M.ancestors(d, id);
  anc.forEach(a => { a.collapsed = false; });
  if (state.focusId && state.focusId !== id && !anc.some(a => a.id === state.focusId)) state.focusId = null;
  if (filtering() && !M.visibleRows(d, visibleOpts()).some(v => v.row.id === id)) setFilter('', 'all');
  if (fld === 'note') { state.noteOpen.add(id); d.notesVisible = true; }
  renderOutline(); renderSidebar();
  const el = rowElById(id); if (el) el.scrollIntoView({ block: 'center' });
}
function highlightFind() {
  if (!window.CSS || !CSS.highlights) return;
  CSS.highlights.delete('find');
  const m = state.find.matches[state.find.idx];
  if (!m || $('#findbar').hidden) return;
  const el = rowElById(m.id); const t = el && el.querySelector(m.field === 'note' ? '.note' : '.topic');
  const node = t && t.firstChild; if (!node || node.nodeType !== 3) return;
  try { const r = new Range(); r.setStart(node, m.index); r.setEnd(node, m.index + m.length); CSS.highlights.set('find', new Highlight(r)); } catch (e) { /* text changed since the search */ }
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- clipboard
function copyRows(e) {
  if (isTyping()) return null;
  const ids = M.topLevel(state.doc, targets()); if (!ids.length) return null;
  const rows = ids.map(id => M.find(state.doc, id).row), text = M.rowsToText(rows);
  e.clipboardData.setData('text/plain', text); e.preventDefault();
  state.clip = { text, rows: JSON.parse(JSON.stringify(rows)) };
  return ids;
}
function pasteRows(text, afterId) {
  const rows = state.clip && state.clip.text.replace(/\r/g, '') === text.replace(/\r/g, '') ? state.clip.rows.map(M.clone)
    : (/^\s*(#{1,6} |[-*+] )/m.test(text) ? M.fromMarkdown(text) : M.fromText(text)).root.children;
  if (filtering()) setFilter('', 'all');
  change(d => {
    const f = afterId && M.find(d, afterId);
    if (f && !f.row.text && !f.row.note && !f.row.children.length) f.parent.children.splice(f.index, 1, ...rows);
    else M.insertRows(d, afterId, rows, !afterId && state.focusId ? state.focusId : null);
    state.sel = new Set(rows.map(r => r.id));
  });
}
document.addEventListener('copy', copyRows);
document.addEventListener('cut', e => { const ids = copyRows(e); if (ids) cmd.deleteRows(); });
document.addEventListener('paste', e => {
  const t = e.target, text = e.clipboardData.getData('text/plain');
  if (t.classList && t.classList.contains('topic') && /\n/.test(text.trim())) {
    e.preventDefault(); pasteRows(text, t.closest('.row').dataset.id);
    const last = [...state.sel].pop(); if (last) focusField(last);
    return;
  }
  if (isTyping() || !text) return;
  e.preventDefault(); pasteRows(text, targets().slice(-1)[0]);
});

// ---------------------------------------------------------------- commands
function newRow({ before = false, child = false } = {}) {
  const id = activeRowId() || targets().slice(-1)[0];
  const r = M.row('');
  if (filtering()) setFilter('', 'all');
  state.pendingFocus = { id: r.id, field: 'topic', caret: 'end' };
  change(d => {
    const f = id && M.find(d, id);
    if (!f) (state.focusId ? M.find(d, state.focusId).row : d.root).children.push(r);
    else if (child) { f.row.children.push(r); f.row.collapsed = false; }
    else if (id === state.focusId || (!before && f.row.children.length && !f.row.collapsed)) { f.row.children.unshift(r); f.row.collapsed = false; }
    else f.parent.children.splice(f.index + (before ? 0 : 1), 0, r);
    state.sel = new Set([r.id]); state.anchor = r.id;
  });
}
function deleteRows(opts = {}) {
  const ids = targets(); if (!ids.length) return;
  const vis = rowEls().map(e => e.dataset.id);
  const gone = new Set();
  ids.forEach(id => { gone.add(id); M.walk(M.find(state.doc, id).row, r => { gone.add(r.id); }); });
  const lastIdx = Math.max(...ids.map(id => vis.indexOf(id)));
  const after = vis.slice(lastIdx + 1).find(id => !gone.has(id)), before = vis.slice(0, Math.max(0, lastIdx)).reverse().find(id => !gone.has(id));
  const next = opts.backspace ? before || after : after || before;
  const editing = isTyping();
  change(d => M.deleteRows(d, ids));
  const target = next && rowElById(next) ? next : (rowEls()[0] ? rowEls()[0].dataset.id : null);
  if (editing && target) focusField(target); else selectOnly(target);
}
function moveFocus(id, dir) {
  const ids = rowEls().map(e => e.dataset.id), t = ids[ids.indexOf(id) + dir];
  if (t) focusField(t, 'topic', 'end');
}
function stepSel(dir, extend) {
  const ids = rowEls().map(e => e.dataset.id); if (!ids.length) return;
  const sel = ids.filter(id => state.sel.has(id));
  const cur = extend ? state.head : (dir < 0 ? sel[0] : sel[sel.length - 1]);
  const i = ids.indexOf(cur);
  const next = ids[i < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, i + dir))];
  if (extend) selectRange(next); else selectOnly(next);
  const el = rowElById(next); if (el) el.scrollIntoView({ block: 'nearest' });
}
function toggleStyle(k) {
  const ids = targets(); if (!ids.length) return;
  change(d => { const rows = ids.map(id => M.find(d, id).row); const on = !rows.every(r => r.style[k]); rows.forEach(r => { if (on) r.style[k] = true; else delete r.style[k]; }); });
}
function setCollapsed(on, all) {
  viewChange(d => {
    if (all) M.walk(state.focusId ? M.find(d, state.focusId).row : d.root, r => { if (r.children.length) r.collapsed = on; });
    else targets().forEach(id => { const r = M.find(d, id).row; if (r.children.length) r.collapsed = on; });
  });
}
// ---------------------------------------------------------------- audio recording
async function toggleRecording() {
  const rec = state.recording;
  if (rec) { rec.recorder.stop(); return; }
  const id = targets()[0] || activeRowId();
  if (!id) return flash('Select a row to record into');
  if (!navigator.mediaDevices || !window.MediaRecorder) return alert('Recording is not available here.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { return alert('Could not use the microphone.\n\nCheck that a microphone is connected and that Windows allows apps to use it (Settings > Privacy & security > Microphone).\n\n' + (e.message || e)); }
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [];
  const started = new Date();
  state.recording = { recorder, seconds: 0, rowId: id, timer: setInterval(() => { state.recording.seconds++; renderStatus(); }, 1000) };
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    clearInterval(state.recording.timer); stream.getTracks().forEach(t => t.stop());
    const rowId = state.recording.rowId; state.recording = null; renderStatus();
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
    if (!bytes.length) return;
    const pad = n => String(n).padStart(2, '0');
    const name = `Recording ${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} ${pad(started.getHours())}.${pad(started.getMinutes())}.${pad(started.getSeconds())}.webm`;
    try {
      const p = host.saveRecording ? await host.saveRecording(state.path, name, bytes) : null;
      if (!p) return alert('Recordings are saved by the Windows app.');
      if (!M.find(state.doc, rowId)) return flash('Recording saved to ' + p);
      change(d => M.find(d, rowId).row.attachments.push({ name, path: p }));
      flash('Recording added');
    } catch (e) { alert('Could not save the recording.\n\n' + (e.message || e)); }
  };
  recorder.start(1000);
  renderStatus();
}

function openModal(...kids) { $('#modal').replaceChildren(h('div', { class: 'box' }, ...kids)); $('#modal').hidden = false; }
const closeHooks = []; // undo anything a dialog set up, however it is closed
function closeModal() { $('#modal').hidden = true; $('#modal').replaceChildren(); while (closeHooks.length) closeHooks.pop()(); }

// ---------------------------------------------------------------- automation
const EXAMPLE_SCRIPT = `// Runs against this outline. Press Ctrl+Z afterwards to undo.
// Example: add a "Next steps" row with two children.
const r = outline.add('Next steps');
outline.add('Review the outline', r);
outline.add('Share it', r);
console.log('Rows now:', outline.rows().length);`;
function scriptApi() {
  const d = state.doc, col = name => d.columns.find(c => c.name === name);
  return {
    get title() { return d.title; }, set title(v) { d.title = String(v); },
    rows: () => M.allRows(d), top: () => d.root.children,
    selection: () => targets().map(id => M.find(d, id).row),
    add(text, parent) { const r = M.row(String(text)); (parent || d.root).children.push(r); return r; },
    find: text => M.allRows(d).filter(r => r.text.toLowerCase().includes(String(text).toLowerCase())),
    remove: r => M.deleteRows(d, [r.id]),
    addColumn(name, type = 'text') { const c = M.column(name, type); d.columns.push(c); return c; },
    value: (r, name) => col(name) && M.cellValue(d, r, col(name)).value,
    setValue(r, name, v) { const c = col(name); if (c) r.values[c.id] = M.parseValue(c, v); },
    check: (r, on = true) => M.setStatus(r, on),
    sort(parent, name, dir = 1) { M.sortChildren(d, parent || d.root, name ? (col(name) || {}).id : null, dir); },
    model: M,
  };
}
function runScript(code) {
  const logs = []; let result;
  endEdit(); pushUndo(snapshot());
  const log = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  try { result = new Function('outline', 'console', '"use strict";\n' + code)(scriptApi(), { log }); }
  catch (e) { logs.push('Error: ' + e.message); }
  if (result !== undefined) logs.push('Result: ' + JSON.stringify(result));
  touched(); render();
  return logs.join('\n') || 'Done.';
}
function automationConsole() {
  const ta = h('textarea', { spellcheck: false, value: localStorage.getItem('arbor.script') || EXAMPLE_SCRIPT });
  const out = h('pre', {}, 'Output appears here.');
  openModal(h('h3', {}, 'Automation'),
    h('p', { class: 'hint' }, 'Write JavaScript that works with the outline: outline.add, outline.rows, outline.find, outline.check, outline.setValue, outline.sort and more. Your last script is kept.'),
    ta, out, h('div', { class: 'actions' }, h('button', { onclick: closeModal }, 'Close'),
      h('button', { class: 'on', onclick: () => { localStorage.setItem('arbor.script', ta.value); out.textContent = runScript(ta.value); } }, 'Run')));
}
const SHORTCUTS = [
  ['Enter', 'New row'], ['Ctrl+Shift+Enter', 'New child row'], ['Shift+Enter', 'Line break inside a row'],
  ['Tab / Shift+Tab', 'Move right / left'], ['Ctrl+Shift+Up / Down', 'Move rows up / down'],
  ['Ctrl+Enter', 'Check or uncheck'], ["Ctrl+'", 'Add or edit the note'], ['Alt+Left / Right', 'Collapse / expand'],
  ['Alt+Shift+Left / Right', 'Collapse / expand everything'], ['Ctrl+Shift+F', 'Focus on the selected rows'],
  ['Esc', 'Stop typing and select the row'], ['Up / Down, Shift+Up / Down', 'Move or extend the selection'],
  ['Space (rows selected)', 'Check or uncheck'], ['Delete (rows selected)', 'Delete rows'], ['Ctrl+Shift+K', 'Delete rows'],
  ['Ctrl+D', 'Duplicate rows'], ['Ctrl+B / I / U', 'Bold / italic / underline'], ['Ctrl+Shift+X', 'Strikethrough'],
  ['Ctrl+C / X / V', 'Copy, cut and paste rows'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+F / Ctrl+H', 'Find / replace'],
  ['F3 / Shift+F3', 'Next / previous match'], ['Ctrl+Shift+L', 'Sidebar'], ['Ctrl+Shift+I', 'Inspector'],
  ['Ctrl+Shift+D', 'Distraction-free mode'], ['Ctrl+Click a web address', 'Open the link'],
  ['Ctrl+N / O / S', 'New / open / save'], ['Ctrl+P', 'Print'], ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom'],
];

// ---------------------------------------------------------------- commands (menus, toolbar, keys)
const cmd = {
  undo, redo,
  newRow: () => newRow(), newRowAbove: () => newRow({ before: true }), newChild: () => newRow({ child: true }),
  indent: () => change(d => M.indent(d, targets())),
  outdent: () => change(d => M.outdent(d, targets(), state.focusId)),
  moveUp: () => change(d => M.moveUp(d, targets())),
  moveDown: () => change(d => M.moveDown(d, targets())),
  toggleStatus() {
    const ids = targets(); if (!ids.length) return;
    change(d => { const rows = ids.map(id => M.find(d, id).row); const on = M.statusOf(rows[0]) !== 'checked'; rows.forEach(r => M.setStatus(r, on)); d.statusVisible = true; });
  },
  deleteRows: () => deleteRows(),
  duplicate() { const ids = targets(); if (ids.length) change(d => { state.sel = new Set(M.duplicate(d, ids)); }); },
  collapse: () => setCollapsed(true, false), expand: () => setCollapsed(false, false),
  collapseAll: () => setCollapsed(true, true), expandAll: () => setCollapsed(false, true),
  focus() { const id = targets()[0]; if (!id) return; state.focusId = state.focusId === id ? null : id; render(); },
  unfocus() { state.focusId = null; render(); },
  toggleNote() {
    const a = document.activeElement;
    if (a && a.classList.contains('note')) return focusField(a.closest('.row').dataset.id, 'topic');
    const id = activeRowId() || targets()[0]; if (!id) return;
    state.noteOpen.add(id); state.pendingFocus = { id, field: 'note', caret: 'end' };
    if (!state.doc.notesVisible) change(d => { d.notesVisible = true; }); else renderOutline();
  },
  bold: () => toggleStyle('bold'), italic: () => toggleStyle('italic'), underline: () => toggleStyle('underline'), strike: () => toggleStyle('strike'),
  clearStyle() { const ids = targets(); if (ids.length) change(d => ids.forEach(id => { const r = M.find(d, id).row; r.style = {}; r.named = []; })); },
  addColumn(type) {
    type = M.TYPES.includes(type) ? type : 'text';
    const n = state.doc.columns.filter(c => c.type === type).length;
    const c = M.column(TYPE_NAMES[type] + (n ? ' ' + (n + 1) : ''), type, { summary: type === 'number' || type === 'duration' ? 'sum' : type === 'checkbox' ? 'state' : 'none' });
    state.inspector = true; state.inspectorTab = 'columns'; state.flashCol = c.id;
    change(d => d.columns.push(c));
  },
  toggleSidebar() { state.sidebar = !state.sidebar; applyTheme(); },
  toggleInspector() { state.inspector = !state.inspector; applyTheme(); renderInspector(); },
  toggleZen() { state.zen = !state.zen; host.setFullScreen(state.zen); applyTheme(); const t = document.querySelector('#rows .row.selected .topic'); if (t) setCaret(t, 'end'); },
  toggleNotes: () => change(d => { d.notesVisible = !d.notesVisible; }),
  toggleStatusColumn: () => change(d => { d.statusVisible = !d.statusVisible; }),
  theme: v => change(d => { d.theme = v; }),
  appearance: v => change(d => { d.appearance = v; }),
  numbering: v => change(d => { d.numbering = v; }),
  find(replace) {
    $('#findbar').hidden = false;
    const sel = getSelection().toString(); if (sel && !sel.includes('\n')) $('#findText').value = sel;
    const box = replace === true ? $('#replaceText') : $('#findText');
    box.focus(); box.select();
  },
  replace() { cmd.find(true); },
  findNext() { if ($('#findbar').hidden) cmd.find(); else findGo(1); },
  findPrev() { if ($('#findbar').hidden) cmd.find(); else findGo(-1); },
  replaceOne() {
    const m = state.find.matches[state.find.idx];
    if (!m) return findGo(1);
    const rep = $('#replaceText').value;
    change(d => { const r = M.find(d, m.id).row; r[m.field] = r[m.field].slice(0, m.index) + rep + r[m.field].slice(m.index + m.length); });
    state.find.idx -= 1; findGo(1);
  },
  replaceAll() {
    const q = $('#findText').value; if (!q) return;
    const re = new RegExp(escRe(q), $('#findCase').checked ? 'g' : 'gi'), rep = $('#replaceText').value;
    let n = 0;
    change(d => M.walk(d.root, r => { for (const f of ['text', 'note']) r[f] = r[f].replace(re, () => { n++; return rep; }); }));
    state.find = { idx: -1, matches: [] };
    $('#findCount').textContent = `Replaced ${n}`;
  },
  closeFind() { $('#findbar').hidden = true; state.find = { idx: -1, matches: [] }; highlightFind(); renderSidebar(); const t = document.querySelector('#rows .row.selected .topic'); if (t) setCaret(t, 'end'); },
  copyLink() {
    if (!state.path) return alert('Save the outline first, then you can copy a link to a row.');
    const id = targets()[0];
    host.copyText(`arbor://open?file=${encodeURIComponent(state.path)}${id ? '&row=' + id : ''}`);
    flash('Link copied');
  },
  newDoc: () => host.newWindow(),
  template(key) { if (state.pristine || host.web) setDoc(M.fromTemplate(key), null); else host.newWindow(key); },
  async open(kind) { const f = await host.openDialog(kind || 'all'); if (f) openContent(f.path, f.content); },
  async import(kind) { importing = true; try { await cmd.open(kind); } finally { importing = false; } },
  filterEditor: () => filterEditor(),
  clearFilter: () => setFilter('', 'all'),
  toggleFolded() { state.folded = !state.folded; setPref('folded', state.folded); applyTheme(); flash(state.folded ? 'Folded editing on' : 'Folded editing off'); },
  toggleTypewriter() { state.typewriter = !state.typewriter; setPref('typewriter', state.typewriter); applyTheme(); centerCaret(); flash(state.typewriter ? 'Typewriter scrolling on' : 'Typewriter scrolling off'); },
  mirrorWindow() {
    if (!host.mirrorWindow) return host.newWindow();
    endEdit(); state.mirrored = true; host.mirrorWindow(JSON.stringify(state.doc), state.path); renderStatus();
  },
  unmirror() { state.mirrored = false; renderStatus(); },
  markDirty() { if (!state.dirty) { state.dirty = true; host.setDirty(true); lastDirty = true; } scheduleAutosave(); renderStatus(); },
  record: () => toggleRecording(),
  async attachFiles() {
    const id = targets()[0]; if (!id) return flash('Select a row first');
    const ps = await host.pickFiles();
    if (ps && ps.length) change(d => M.find(d, id).row.attachments.push(...ps.map(p => ({ name: p.split(/[\\/]/).pop(), path: p }))));
  },
  export: kind => exportAs(kind),
  save: () => save(false), saveAs: () => save(true),
  async saveThenClose() { if (await save(false)) host.closeWindow(); },
  print: () => host.print(),
  automation: automationConsole,
  shortcuts: () => shortcutsEditor(),
  selectAll() { if (isTyping()) return document.execCommand('selectAll'); state.sel = new Set(rowEls().map(e => e.dataset.id)); paintSelection(); },
};
function run(action) {
  const i = action.indexOf(':');
  const name = i < 0 ? action : action.slice(0, i), arg = i < 0 ? undefined : action.slice(i + 1);
  if (cmd[name]) return cmd[name](arg);
}

// ---------------------------------------------------------------- keyboard
// Typewriter scrolling: the line being typed stays in the middle of the window.
function centerCaret() {
  if (!state.typewriter) return;
  const a = document.activeElement; if (!a || !a.closest || !a.closest('#rows')) return;
  const s = getSelection(); if (!s.rangeCount) return;
  let rect = s.getRangeAt(0).getBoundingClientRect();
  if (!rect.height) rect = a.getBoundingClientRect();
  const o = $('#outline'), ob = o.getBoundingClientRect();
  const delta = (rect.top + rect.height / 2) - (ob.top + ob.height * 0.45);
  if (Math.abs(delta) > 2) o.scrollTop += delta;
}
document.addEventListener('selectionchange', () => { if (state.typewriter) requestAnimationFrame(centerCaret); });

const ROW_KEYS = {
  'Tab': 'indent', 'Shift+Tab': 'outdent', 'Ctrl+Shift+ArrowUp': 'moveUp', 'Ctrl+Shift+ArrowDown': 'moveDown',
  'Ctrl+Enter': 'toggleStatus', 'Ctrl+Shift+Enter': 'newChild', 'Alt+ArrowLeft': 'collapse', 'Alt+ArrowRight': 'expand',
  'Alt+Shift+ArrowLeft': 'collapseAll', 'Alt+Shift+ArrowRight': 'expandAll', "Ctrl+'": 'toggleNote',
  'Ctrl+b': 'bold', 'Ctrl+i': 'italic', 'Ctrl+u': 'underline', 'Ctrl+Shift+X': 'strike',
  'Ctrl+d': 'duplicate', 'Ctrl+Shift+K': 'deleteRows', 'Ctrl+Shift+F': 'focus',
};
const GLOBAL_KEYS = {
  'Ctrl+z': 'undo', 'Ctrl+y': 'redo', 'Ctrl+Shift+Z': 'redo', 'Ctrl+f': 'find', 'Ctrl+h': 'replace',
  'F3': 'findNext', 'Shift+F3': 'findPrev', 'Ctrl+Shift+D': 'toggleZen', 'Ctrl+Shift+L': 'toggleSidebar', 'Ctrl+Shift+I': 'toggleInspector',
};
const DEFAULT_ROW_KEYS = { ...ROW_KEYS }, DEFAULT_GLOBAL_KEYS = { ...GLOBAL_KEYS };
function keyName(e) {
  // Letters and digits by their key position, so Shift and keyboard layouts don't change the name.
  let k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key;
  if (k.length === 1) k = e.shiftKey ? k.toUpperCase() : k.toLowerCase();
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean).concat(k).join('+');
}
// Electron accelerator ("Ctrl+Shift+Up") to the name keyName() gives ("Ctrl+Shift+ArrowUp").
const ACCEL_KEYS = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Space: ' ', Esc: 'Escape', Return: 'Enter', Plus: '+', PageUp: 'PageUp', PageDown: 'PageDown' };
function accelToKey(a) {
  if (!a) return '';
  const parts = a.split('+').filter(Boolean); let k = parts.pop() || '';
  if (a.endsWith('++')) k = '+';
  const mods = new Set(parts.map(p => p.replace(/^(CmdOrCtrl|CommandOrControl|Control)$/, 'Ctrl')));
  k = ACCEL_KEYS[k] || k;
  if (k.length === 1) k = mods.has('Shift') ? k.toUpperCase() : k.toLowerCase();
  return ['Ctrl', 'Alt', 'Shift'].filter(m => mods.has(m)).concat(k).join('+');
}
function keyToAccel(name) {
  const parts = name.split('+'); let k = parts.pop() || '+';
  if (name.endsWith('++')) k = '+';
  const back = Object.fromEntries(Object.entries(ACCEL_KEYS).map(([a, b]) => [b, a]));
  k = back[k] || (k.length === 1 ? k.toUpperCase() : k);
  return parts.concat(k).join('+');
}
// Shortcuts the person changed replace the built-in ones for those commands.
function applyShortcuts(over) {
  state.shortcuts = over || {};
  const taken = new Set(Object.values(state.shortcuts).filter(Boolean).map(accelToKey));
  for (const [map, dflt] of [[ROW_KEYS, DEFAULT_ROW_KEYS], [GLOBAL_KEYS, DEFAULT_GLOBAL_KEYS]]) {
    for (const k of Object.keys(map)) delete map[k];
    for (const [k, action] of Object.entries(dflt)) if (!(action in state.shortcuts) && !taken.has(k)) map[k] = action;
  }
}
// Help > Keyboard Shortcuts: every menu command, with the key for it; click a key to change it.
async function shortcutsEditor() {
  const info = host.getShortcuts ? await host.getShortcuts() : { commands: [], overrides: {} };
  const over = { ...info.overrides };
  const keyOf = c => (c.action in over ? over[c.action] : c.default) || '';
  const pretty = a => a ? a.replace(/\bUp\b/, '↑').replace(/\bDown\b/, '↓').replace(/\bLeft\b/, '←').replace(/\bRight\b/, '→') : '';
  const search = h('input', { type: 'search', placeholder: 'Search commands' });
  const msg = h('div', { class: 'hint' }, 'Click a shortcut, then press the new keys. Backspace removes it; Esc cancels.');
  const body = h('tbody');
  let recording = null;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    body.replaceChildren(...info.commands.filter(c => !q || (c.menu + ' ' + c.label).toLowerCase().includes(q)).map(c => {
      const custom = c.action in over;
      const btn = h('button', { class: 'keycap' + (recording === c.action ? ' recording' : '') + (custom ? ' custom' : ''),
        onclick: () => { recording = c.action; draw(); } }, recording === c.action ? 'Press keys…' : pretty(keyOf(c)) || 'None');
      return h('tr', {}, h('td', { class: 'menu' }, c.menu), h('td', {}, c.label), h('td', {}, btn),
        h('td', {}, custom ? h('button', { title: 'Use the original shortcut', onclick: () => { delete over[c.action]; draw(); } }, 'Reset') : null));
    }));
  };
  const onKey = e => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey) { recording = null; draw(); return; }
    const c = info.commands.find(x => x.action === recording);
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey) { over[c.action] = ''; recording = null; draw(); return; }
    const fkey = /^F\d{1,2}$/.test(e.key);
    if (!e.ctrlKey && !e.altKey && !fkey) { msg.textContent = 'Use Ctrl or Alt with the key (or a function key), so typing is not affected.'; msg.classList.add('warn'); return; }
    const accel = keyToAccel(keyName(e));
    const clash = info.commands.find(x => x.action !== c.action && keyOf(x).toLowerCase() === accel.toLowerCase());
    if (clash) { over[clash.action] = ''; msg.textContent = `${accel} was used by “${clash.label}”, which now has no shortcut.`; msg.classList.add('warn'); }
    else { msg.textContent = 'Click a shortcut, then press the new keys. Backspace removes it; Esc cancels.'; msg.classList.remove('warn'); }
    over[c.action] = accel === c.default ? undefined : accel;
    if (over[c.action] === undefined) delete over[c.action];
    recording = null; draw();
  };
  document.addEventListener('keydown', onKey, true);
  search.addEventListener('input', draw);
  draw();
  const done = closeModal;
  openModal(h('h3', {}, 'Keyboard shortcuts'), h('div', { class: 'row-between' }, search, msg),
    h('div', { class: 'scroll' }, h('table', { class: 'keys' }, body)),
    h('h5', {}, 'Other keys'),
    h('table', {}, SHORTCUTS.filter(([k]) => /Esc|Space|Delete|Shift\+Enter|Up \/ Down|Click/.test(k)).map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))),
    h('div', { class: 'actions' },
      h('button', { onclick: () => { for (const k of Object.keys(over)) delete over[k]; draw(); } }, 'Reset all'),
      h('span', { class: 'spacer' }),
      h('button', { onclick: done }, 'Cancel'),
      h('button', { class: 'on', onclick: async () => { if (host.setShortcuts) await host.setShortcuts(over); applyShortcuts(over); done(); flash('Shortcuts saved'); } }, 'Save')));
  closeHooks.push(() => document.removeEventListener('keydown', onKey, true));
}
document.addEventListener('keydown', e => {
  const k = keyName(e), t = e.target;
  if (!$('#modal').hidden) { if (k === 'Escape') closeModal(); return; }
  if (t.closest && t.closest('#findbar')) {
    if (k === 'Escape') { e.preventDefault(); return cmd.closeFind(); }
    if (k === 'Enter' || k === 'Shift+Enter') { e.preventDefault(); return t.id === 'replaceText' && k === 'Enter' ? cmd.replaceOne() : findGo(k === 'Enter' ? 1 : -1); }
  }
  if (GLOBAL_KEYS[k]) { e.preventDefault(); return run(GLOBAL_KEYS[k]); }
  const inTopic = t.classList && t.classList.contains('topic'), inNote = t.classList && t.classList.contains('note');
  const selMode = !inTopic && !inNote && (t === document.body || t.id === 'outline');
  if (!inTopic && !inNote && !selMode) return;
  if (inNote) {
    if (k === "Ctrl+'" || k === 'Escape') { e.preventDefault(); return focusField(t.closest('.row').dataset.id, 'topic'); }
    if (k === 'Tab' || k === 'Shift+Tab') { e.preventDefault(); return; }
  }
  if (ROW_KEYS[k] && (inTopic || inNote || state.sel.size)) { e.preventDefault(); return run(ROW_KEYS[k]); }
  if (inTopic) return topicKey(e, k, t);
  if (selMode) return selectionKey(e, k);
});
function topicKey(e, k, el) {
  const id = el.closest('.row').dataset.id, f = M.find(state.doc, id); if (!f) return;
  const text = readText(el), c = getCaret(el), caret = c == null ? text.length : c;
  switch (k) {
    case 'Enter': e.preventDefault(); newRow({ before: caret === 0 && text.length > 0 }); break;
    case 'Backspace':
      if (!text && !f.row.children.length && !f.row.note && M.allRows(state.doc).length > 1) { e.preventDefault(); deleteRows({ backspace: true }); }
      break;
    case 'ArrowUp': if (!text.slice(0, caret).includes('\n')) { e.preventDefault(); moveFocus(id, -1); } break;
    case 'ArrowDown': if (!text.slice(caret).includes('\n')) { e.preventDefault(); moveFocus(id, 1); } break;
    case 'Shift+ArrowUp': case 'Shift+ArrowDown':
      if (!text.includes('\n')) { e.preventDefault(); enterSelection(); selectOnly(id); stepSel(k.endsWith('Up') ? -1 : 1, true); }
      break;
    case 'Escape': e.preventDefault(); enterSelection(); break;
  }
}
function selectionKey(e, k) {
  const sel = () => targets();
  switch (k) {
    case 'ArrowUp': e.preventDefault(); stepSel(-1, false); break;
    case 'ArrowDown': e.preventDefault(); stepSel(1, false); break;
    case 'Shift+ArrowUp': e.preventDefault(); stepSel(-1, true); break;
    case 'Shift+ArrowDown': e.preventDefault(); stepSel(1, true); break;
    case 'ArrowLeft': if (sel().length) { e.preventDefault(); cmd.collapse(); } break;
    case 'ArrowRight': if (sel().length) { e.preventDefault(); cmd.expand(); } break;
    case 'Enter': case 'F2': { const ids = sel(); if (ids.length) { e.preventDefault(); focusField(ids[ids.length - 1]); } break; }
    case ' ': if (sel().length) { e.preventDefault(); cmd.toggleStatus(); } break;
    case 'Delete': case 'Backspace': if (sel().length) { e.preventDefault(); cmd.deleteRows(); } break;
    case 'Ctrl+a': e.preventDefault(); cmd.selectAll(); break;
    case 'Escape': if (state.zen) cmd.toggleZen(); else selectOnly(null); break;
  }
}

// ---------------------------------------------------------------- start-up
document.addEventListener('click', e => { const b = e.target.closest('button[data-cmd]'); if (b) run(b.dataset.cmd); });
// Toolbar buttons must not steal the text cursor from the row being edited.
for (const s of ['#toolbar', '#findbar', '#focusbar']) $(s).addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('#filter').addEventListener('input', e => setFilter(e.target.value, state.filter.status, state.filter.rules));
$('#statusFilter').addEventListener('change', e => setFilter(state.filter.text, e.target.value, state.filter.rules));
$('#findText').addEventListener('input', () => { state.find.idx = -1; findGo(1); });
$('#findCase').addEventListener('change', () => { state.find.idx = -1; findGo(1); });
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
$('#rows').addEventListener('mousedown', e => { if (e.target.id === 'rows' && !isTyping()) selectOnly(null); });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) {
    if (!/\.(arbor|opml|md|markdown|txt|rtf)$/i.test(f.name)) continue;
    const p = host.pathForFile(f);
    if (p && !host.web) host.openInNewWindow(p); else openContent(f.name, await f.text());
  }
});
host.onMenu(run);
host.onLoad(({ path, content, reveal: rid }) => { loadContent(path, content); if (rid) { reveal(rid); selectOnly(rid); } });
host.onReveal(id => { reveal(id); selectOnly(id); });
if (host.onShortcuts) host.onShortcuts(applyShortcuts);
if (host.onSync) host.onSync(receiveSync);
if (host.onMirror) host.onMirror(m => { setDoc(M.normalize(JSON.parse(m.doc)), m.path || null); state.mirrored = true; state.pristine = false; renderStatus(); });
render();
focusFirst();
window.__arbor = { state, cmd, run, M, loadContent, save, setDoc, runScript, applyShortcuts, keyName, accelToKey, keyToAccel }; // used by the automated tests

// ---------------------------------------------------------------- browser fallback (the app also runs in a plain browser)
function webShim() {
  const pickFile = accept => new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = async () => { const f = i.files[0]; res(f ? { path: f.name, content: await f.text() } : null); };
    i.click();
  });
  const download = (name, content) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: typeof content === 'string' ? 'text/plain' : 'application/octet-stream' }));
    a.download = name.split(/[\\/]/).pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const none = () => {};
  return {
    web: true, onMenu: none, onLoad: none, onReveal: none, setDirty: none, setPath: none,
    setFullScreen: on => { if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(none); else if (!on && document.fullscreenElement) document.exitFullscreen(); },
    openDialog: () => pickFile('.arbor,.opml,.md,.markdown,.txt,.json,.rtf'),
    saveDialog: async name => name, writeFile: async (p, c) => download(p, c),
    exportPDF: async () => { window.print(); return null; }, print: () => window.print(),
    openExternal: u => window.open(u, '_blank', 'noopener'), openPath: none, pathForFile: () => '',
    pickFiles: async () => [], copyText: t => navigator.clipboard && navigator.clipboard.writeText(t),
    newWindow: () => window.open(location.href, '_blank'), openInNewWindow: none, closeWindow: none,
  };
}
