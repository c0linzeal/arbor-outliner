// Outline document model: pure functions, shared by the app and the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let counter = 0;
  const uid = () => Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);

  function row(text = '', extra = {}) {
    return Object.assign({ id: uid(), text, note: '', state: false, values: {}, collapsed: false,
      style: {}, named: [], attachments: [], children: [] }, extra);
  }

  const SUMMARIES = {
    text: ['none', 'hidden'],
    popup: ['none', 'hidden'],
    number: ['none', 'sum', 'avg', 'min', 'max', 'hidden'],
    duration: ['none', 'sum', 'avg', 'min', 'max', 'hidden'],
    date: ['none', 'min', 'max', 'hidden'],
    checkbox: ['none', 'state', 'hidden'],
  };
  const TYPES = Object.keys(SUMMARIES);

  function column(name, type = 'text', extra = {}) {
    return Object.assign({ id: uid(), name, type, summary: 'none', options: [], width: type === 'checkbox' ? 80 : 120, hidden: false }, extra);
  }

  function newDoc(title = 'Untitled') {
    return {
      format: 'arbor-outline', version: 1, title,
      columns: [],
      statusVisible: true, notesVisible: true, numbering: 'none',
      theme: 'standard', appearance: 'system',
      styles: {
        base: { fontFamily: 'Segoe UI', fontSize: 15, lineHeight: 1.45 },
        levels: [{ bold: true }, {}, {}, {}],
        named: [
          { id: 'highlight', name: 'Highlight', highlight: '#fff3a3', color: '#222222' },
          { id: 'emphasis', name: 'Emphasis', bold: true, color: '#c2410c' },
          { id: 'quote', name: 'Quote', italic: true },
          { id: 'done', name: 'Done', strike: true, color: '#8a8a8a' },
        ],
      },
      filters: [],
      root: { id: 'root', children: [row('')] },
    };
  }

  // Fill in anything missing from a loaded document (older files, hand-edited JSON).
  function normalize(d) {
    const base = newDoc(d.title || 'Untitled');
    const doc = Object.assign(base, d);
    doc.styles = Object.assign(newDoc().styles, d.styles || {});
    doc.columns = (d.columns || []).map(c => Object.assign(column(c.name || 'Column', TYPES.includes(c.type) ? c.type : 'text'), c));
    doc.filters = d.filters || [];
    const fix = r => { const n = Object.assign(row(''), r); n.children = (r.children || []).map(fix); return n; };
    doc.root = { id: 'root', children: ((d.root && d.root.children) || []).map(fix) };
    if (!doc.root.children.length) doc.root.children.push(row(''));
    return doc;
  }

  // ---- tree walking ----
  function walk(node, fn, depth = 0) {
    (node.children || []).forEach((c, i) => { if (fn(c, depth, node, i) !== false) walk(c, fn, depth + 1); });
  }
  function find(doc, id) {
    if (id === 'root') return { row: doc.root, parent: null, index: -1, depth: -1 };
    let hit = null;
    walk(doc.root, (r, depth, parent, index) => { if (hit) return false; if (r.id === id) hit = { row: r, parent, index, depth }; });
    return hit;
  }
  function ancestors(doc, id) {
    const out = [];
    const visit = (node, trail) => {
      for (const c of node.children) {
        if (c.id === id) { out.push(...trail); return true; }
        if (visit(c, trail.concat(c))) return true;
      }
      return false;
    };
    visit(doc.root, []);
    return out;
  }
  function contains(r, id) { let f = false; walk(r, c => { if (c.id === id) f = true; }); return f; }
  // Selected ids minus those inside another selected row, in document order.
  function topLevel(doc, ids) {
    const set = new Set(ids), out = [];
    walk(doc.root, r => { if (set.has(r.id)) { out.push(r.id); return false; } });
    return out;
  }
  function allRows(doc) { const out = []; walk(doc.root, r => { out.push(r); }); return out; }

  // ---- status checkboxes ----
  function statusOf(r) {
    if (!r.children.length) return r.state ? 'checked' : 'unchecked';
    const s = r.children.map(statusOf);
    if (s.every(x => x === 'checked')) return 'checked';
    if (s.every(x => x === 'unchecked')) return 'unchecked';
    return 'mixed';
  }
  function setStatus(r, checked) { r.state = checked; r.children.forEach(c => setStatus(c, checked)); }

  // ---- visible rows (collapse, focus, filter) ----
  // Column conditions for filters, by column type: [op, label, needs a value]
  const RULE_OPS = {
    text: [['contains', 'contains', 1], ['is', 'is', 1], ['not', 'is not', 1], ['empty', 'is empty', 0], ['filled', 'is not empty', 0]],
    popup: [['is', 'is', 1], ['not', 'is not', 1], ['empty', 'is empty', 0], ['filled', 'is not empty', 0]],
    number: [['eq', '=', 1], ['ne', '≠', 1], ['lt', '<', 1], ['le', '≤', 1], ['gt', '>', 1], ['ge', '≥', 1], ['empty', 'is empty', 0], ['filled', 'is not empty', 0]],
    duration: [['eq', '=', 1], ['lt', '<', 1], ['gt', '>', 1], ['empty', 'is empty', 0], ['filled', 'is not empty', 0]],
    date: [['on', 'is on', 1], ['before', 'is before', 1], ['after', 'is after', 1], ['next', 'is in the next … days', 1], ['past', 'is past (before today)', 0], ['empty', 'is empty', 0], ['filled', 'is not empty', 0]],
    checkbox: [['checked', 'is checked', 0], ['unchecked', 'is not checked', 0]],
  };
  const isoToday = (now = new Date()) => new Date(now.getTime() - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  function matchRule(doc, r, rule) {
    const col = doc.columns.find(c => c.id === rule.col); if (!col) return true;
    const v = cellValue(doc, r, col).value, empty = v === undefined || v === null || v === '';
    const op = rule.op;
    if (op === 'empty') return empty;
    if (op === 'filled') return !empty;
    if (col.type === 'checkbox') return op === 'checked' ? v === true : v !== true;
    if (col.type === 'text' || col.type === 'popup') {
      const a = String(empty ? '' : v).toLowerCase(), b = String(rule.value || '').toLowerCase();
      return op === 'contains' ? a.includes(b) : op === 'is' ? a === b : op === 'not' ? a !== b : true;
    }
    if (col.type === 'date') {
      const today = isoToday();
      if (op === 'past') return !empty && v < today;
      if (empty) return false;
      if (op === 'next') { const end = isoToday(new Date(Date.now() + (parseInt(rule.value, 10) || 0) * 864e5)); return v >= today && v <= end; }
      const b = parseValue(col, rule.value); if (!b) return true;
      return op === 'on' ? v === b : op === 'before' ? v < b : op === 'after' ? v > b : true;
    }
    if (empty) return op === 'ne';
    const b = parseValue(col, rule.value); if (b === undefined) return true;
    return { eq: v === b, ne: v !== b, lt: v < b, le: v <= b, gt: v > b, ge: v >= b }[op] !== false;
  }
  function matchesFilter(doc, r, q, status, rules) {
    if (status && status !== 'all' && (status === 'checked') !== (statusOf(r) === 'checked')) return false;
    if (rules && !rules.every(rule => matchRule(doc, r, rule))) return false;
    if (!q) return true;
    const vals = doc.columns.map(c => formatValue(c, r.values[c.id])).join(' ');
    return (r.text + '\n' + r.note + '\n' + vals).toLowerCase().includes(q);
  }
  function visibleRows(doc, opts = {}) {
    const out = [];
    const q = (opts.text || '').trim().toLowerCase();
    const status = opts.status || 'all';
    const rules = (opts.rules || []).filter(x => doc.columns.some(c => c.id === x.col));
    const filtering = !!q || status !== 'all' || rules.length > 0;
    const memo = new Map();
    const keep = r => {
      if (memo.has(r.id)) return memo.get(r.id);
      const k = matchesFilter(doc, r, q, status, rules) || r.children.some(keep);
      memo.set(r.id, k);
      return k;
    };
    const visit = (r, depth) => {
      if (filtering && !keep(r)) return;
      out.push({ row: r, depth });
      if (filtering || !r.collapsed) r.children.forEach(c => visit(c, depth + 1));
    };
    // Focus on one or more sections: each is shown at the top level, in outline order,
    // and always shows its children even if it is collapsed.
    const ids = topLevel(doc, opts.focusIds || (opts.focusId ? [opts.focusId] : []));
    if (ids.length) {
      for (const id of ids) {
        const f = find(doc, id);
        if (filtering && !keep(f.row)) continue;
        out.push({ row: f.row, depth: 0 });
        f.row.children.forEach(c => visit(c, 1));
      }
    } else doc.root.children.forEach(c => visit(c, 0));
    return out;
  }

  // ---- editing operations ----
  function clone(r) { const c = JSON.parse(JSON.stringify(r)); const fresh = n => { n.id = uid(); n.children.forEach(fresh); }; fresh(c); return c; }

  function indent(doc, ids) {
    for (const id of topLevel(doc, ids)) {
      const f = find(doc, id);
      if (f.index === 0) continue;
      const prev = f.parent.children[f.index - 1];
      f.parent.children.splice(f.index, 1);
      prev.children.push(f.row);
      prev.collapsed = false;
    }
  }
  // limit: a focused row id (or list of them); rows directly inside it stay inside it.
  function outdent(doc, ids, limit) {
    const stop = new Set([].concat(limit || []));
    for (const id of topLevel(doc, ids).reverse()) {
      const f = find(doc, id);
      if (f.parent === doc.root || stop.has(f.parent.id)) continue;
      const p = find(doc, f.parent.id);
      f.parent.children.splice(f.index, 1);
      p.parent.children.splice(p.index + 1, 0, f.row);
    }
  }
  function moveUp(doc, ids) {
    const list = topLevel(doc, ids);
    if (list.some(id => find(doc, id).index === 0)) return false;
    for (const id of list) { const f = find(doc, id); const a = f.parent.children; [a[f.index - 1], a[f.index]] = [a[f.index], a[f.index - 1]]; }
    return true;
  }
  function moveDown(doc, ids) {
    const list = topLevel(doc, ids).reverse();
    if (list.some(id => { const f = find(doc, id); return f.index === f.parent.children.length - 1; })) return false;
    for (const id of list) { const f = find(doc, id); const a = f.parent.children; [a[f.index + 1], a[f.index]] = [a[f.index], a[f.index + 1]]; }
    return true;
  }
  function deleteRows(doc, ids) {
    for (const id of topLevel(doc, ids)) { const f = find(doc, id); f.parent.children.splice(f.index, 1); }
    if (!doc.root.children.length) doc.root.children.push(row(''));
  }
  function duplicate(doc, ids) {
    const made = [];
    for (const id of topLevel(doc, ids).reverse()) {
      const f = find(doc, id); const c = clone(f.row);
      f.parent.children.splice(f.index + 1, 0, c); made.unshift(c.id);
    }
    return made;
  }
  // Move rows before/after/inside a target row (drag and drop).
  function moveTo(doc, ids, targetId, pos) {
    const list = topLevel(doc, ids);
    if (list.some(id => id === targetId || contains(find(doc, id).row, targetId))) return false;
    const rows = list.map(id => { const f = find(doc, id); f.parent.children.splice(f.index, 1); return f.row; });
    const t = find(doc, targetId);
    if (pos === 'inside') { t.row.children.push(...rows); t.row.collapsed = false; }
    else t.parent.children.splice(t.index + (pos === 'after' ? 1 : 0), 0, ...rows);
    return true;
  }
  function insertRows(doc, afterId, rows, parentId) {
    if (parentId) { find(doc, parentId).row.children.push(...rows); return; }
    const f = afterId && find(doc, afterId);
    if (!f) doc.root.children.push(...rows);
    else f.parent.children.splice(f.index + 1, 0, ...rows);
  }

  // ---- values, durations, summaries ----
  const UNIT_HOURS = { w: 40, d: 8, h: 1, m: 1 / 60 };
  function parseDuration(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim().toLowerCase();
    if (!s) return undefined;
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    let total = 0, ok = false;
    s.replace(/(-?\d+(?:\.\d+)?)\s*([wdhm])[a-z]*/g, (_, n, u) => { total += parseFloat(n) * UNIT_HOURS[u]; ok = true; });
    return ok ? Math.round(total * 1000) / 1000 : undefined;
  }
  function formatDuration(h) {
    if (h === undefined || h === null || h === '' || isNaN(h)) return '';
    let rem = Math.round(Math.abs(h) * 60); const parts = [];
    for (const [u, mins] of [['w', 2400], ['d', 480], ['h', 60], ['m', 1]]) {
      if (rem >= mins) { parts.push(Math.floor(rem / mins) + u); rem %= mins; }
    }
    return (h < 0 ? '-' : '') + (parts.join(' ') || '0h');
  }
  function parseNumber(s) {
    if (typeof s === 'number') return s;
    const t = String(s == null ? '' : s).replace(/[,\s]/g, '').replace(/[^\d.eE+-]/g, '');
    if (!t) return undefined;
    const n = parseFloat(t);
    return isNaN(n) ? undefined : n;
  }
  function parseValue(col, s) {
    switch (col.type) {
      case 'number': return parseNumber(s);
      case 'duration': return parseDuration(s);
      case 'checkbox': return s === true || /^(true|yes|checked|1|x)$/i.test(String(s).trim());
      case 'date': { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[0] : undefined; }
      default: return s == null || s === '' ? undefined : String(s);
    }
  }
  function formatValue(col, v) {
    if (v === undefined || v === null || v === '') return '';
    switch (col.type) {
      case 'number': return String(+(+v).toFixed(6));
      case 'duration': return formatDuration(v);
      case 'checkbox': return v === 'mixed' ? 'mixed' : v ? 'checked' : 'unchecked';
      default: return String(v);
    }
  }
  // A cell's value: its own, or a summary of its children when the column summarises.
  function cellValue(doc, r, col) {
    const s = col.summary || 'none';
    if (!r.children.length || s === 'none') return { value: r.values[col.id], computed: false };
    if (s === 'hidden') return { value: undefined, computed: true };
    const vals = r.children.map(c => cellValue(doc, c, col).value);
    if (col.type === 'checkbox') {
      const b = vals.map(v => v === 'mixed' ? 'mixed' : !!v);
      return { value: b.every(v => v === true) ? true : b.every(v => v === false) ? false : 'mixed', computed: true };
    }
    const xs = vals.filter(v => v !== undefined && v !== null && v !== '');
    if (!xs.length) return { value: undefined, computed: true };
    if (col.type === 'date') { const sorted = xs.slice().sort(); return { value: s === 'min' ? sorted[0] : sorted[sorted.length - 1], computed: true }; }
    const ns = xs.map(Number);
    const sum = ns.reduce((a, b) => a + b, 0);
    const value = s === 'sum' ? sum : s === 'avg' ? sum / ns.length : s === 'min' ? Math.min(...ns) : Math.max(...ns);
    return { value: Math.round(value * 1e6) / 1e6, computed: true };
  }
  function setCheckboxCell(r, col, on) { r.values[col.id] = on; if (col.summary === 'state') r.children.forEach(c => setCheckboxCell(c, col, on)); }
  function convertColumn(doc, col, type) {
    walk(doc.root, r => {
      const old = formatValue(col, r.values[col.id]);
      if (old === '') { delete r.values[col.id]; return; }
      const v = parseValue({ type }, old);
      if (v === undefined) delete r.values[col.id]; else r.values[col.id] = v;
      if (type === 'popup' && !col.options.includes(v)) col.options.push(v);
    });
    col.type = type;
    if (!SUMMARIES[type].includes(col.summary)) col.summary = 'none';
  }
  function sortChildren(doc, parent, colId, dir = 1) {
    const col = doc.columns.find(c => c.id === colId);
    const key = r => {
      if (!col) return r.text.toLowerCase();
      const v = cellValue(doc, r, col).value;
      if (v === undefined || v === '') return undefined;
      if (col.type === 'popup') return col.options.indexOf(v);
      if (col.type === 'checkbox') return v === true ? 1 : v === 'mixed' ? 0.5 : 0;
      return v;
    };
    parent.children.sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === undefined) return y === undefined ? 0 : 1;
      if (y === undefined) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y) * dir;
    });
  }

  // ---- numbering ----
  function roman(n) {
    const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
  }
  function alpha(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
  function prefix(style, path) {
    const n = path[path.length - 1], d = path.length - 1;
    switch (style) {
      case 'decimal': return path.join('.');
      case 'simple': return n + '.';
      case 'outline': return [roman, x => alpha(x).toUpperCase(), String, alpha, x => roman(x).toLowerCase()][d % 5](n) + '.';
      default: return '';
    }
  }
  function numberPaths(doc) {
    const paths = new Map();
    const visit = (node, trail) => node.children.forEach((c, i) => { const p = trail.concat(i + 1); paths.set(c.id, p); visit(c, p); });
    visit(doc.root, []);
    return paths;
  }

  // ---- styles ----
  function resolveStyle(doc, r, depth) {
    const s = Object.assign({}, doc.styles.base, doc.styles.levels[depth] || {});
    for (const id of r.named || []) {
      const n = doc.styles.named.find(x => x.id === id);
      if (n) { const { id: _i, name: _n, ...rest } = n; Object.assign(s, rest); }
    }
    return Object.assign(s, r.style);
  }
  function styleCss(s) {
    const out = [];
    if (s.fontFamily) out.push(`font-family:"${s.fontFamily}",system-ui,sans-serif`);
    if (s.fontSize) out.push(`font-size:${s.fontSize}px`);
    if (s.lineHeight) out.push(`line-height:${s.lineHeight}`);
    if (s.bold) out.push('font-weight:700');
    if (s.italic) out.push('font-style:italic');
    const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean);
    if (deco.length) out.push('text-decoration:' + deco.join(' '));
    if (s.color) out.push('color:' + s.color);
    if (s.highlight) out.push('background-color:' + s.highlight);
    return out.join(';');
  }

  // ---- counts ----
  function stats(doc) {
    let rows = 0, words = 0, leaves = 0, checked = 0;
    const wc = t => (t.match(/\S+/g) || []).length;
    walk(doc.root, r => {
      rows++; words += wc(r.text) + wc(r.note);
      if (!r.children.length) { leaves++; if (r.state) checked++; }
    });
    return { rows, words, leaves, checked };
  }

  // ---- import / export ----
  const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
  const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function decodeXml(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e) => {
      const k = e.toLowerCase();
      if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k];
    });
  }
  const attrName = n => { const s = String(n).trim().replace(/[^A-Za-z0-9_-]/g, '_'); return /^[A-Za-z_]/.test(s) ? s : '_' + s; };

  function toOPML(doc) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head>', `    <title>${escXml(doc.title)}</title>`,
      // Column types and summaries, so a round trip through OPML keeps them. Other apps ignore it.
      `    <arborColumns>${escXml(JSON.stringify(doc.columns.map(({ name, type, summary, options, width, hidden }) => ({ name, type, summary, options, width, hidden }))))}</arborColumns>`,
      '  </head>', '  <body>'];
    const emit = (r, d) => {
      const pad = '    ' + '  '.repeat(d);
      let a = `text="${escXml(r.text)}"`;
      if (r.note) a += ` _note="${escXml(r.note)}"`;
      if (doc.statusVisible) a += ` _status="${statusOf(r) === 'checked' ? 'checked' : 'unchecked'}"`;
      for (const c of doc.columns) {
        const v = formatValue(c, r.values[c.id]);
        if (v !== '') a += ` ${attrName(c.name)}="${escXml(v)}"`;
      }
      if (!r.children.length) { out.push(`${pad}<outline ${a}/>`); return; }
      out.push(`${pad}<outline ${a}>`);
      r.children.forEach(c => emit(c, d + 1));
      out.push(`${pad}</outline>`);
    };
    doc.root.children.forEach(r => emit(r, 0));
    out.push('  </body>', '</opml>');
    return out.join('\n') + '\n';
  }
  function guessType(values) {
    const v = values.filter(x => x !== '');
    if (!v.length) return 'text';
    if (v.every(x => /^(checked|unchecked)$/.test(x))) return 'checkbox';
    if (v.every(x => /^-?[\d,]*\.?\d+$/.test(x))) return 'number';
    if (v.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x))) return 'date';
    if (v.every(x => /^-?(\d+(\.\d+)?[wdhm]\s*)+$/.test(x))) return 'duration';
    return 'text';
  }
  function fromOPML(xml) {
    const doc = newDoc(); doc.root.children = []; doc.statusVisible = false;
    const t = /<title>([\s\S]*?)<\/title>/i.exec(xml);
    if (t && decodeXml(t[1]).trim()) doc.title = decodeXml(t[1]).trim();
    const body = xml.slice(Math.max(0, xml.search(/<body/i)));
    const stack = [doc.root], cols = new Map(), raw = new Map(), typed = new Set();
    const ac = /<arborColumns>([\s\S]*?)<\/arborColumns>/i.exec(xml);
    if (ac) {
      try {
        for (const def of JSON.parse(decodeXml(ac[1]))) {
          const c = column(def.name, TYPES.includes(def.type) ? def.type : 'text', def);
          cols.set(attrName(def.name), c); raw.set(c.id, []); typed.add(c.id); doc.columns.push(c);
        }
      } catch (e) { /* ignore a damaged column list; values still import as text */ }
    }
    const re = /<outline\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\/outline\s*>/gi;
    let m;
    while ((m = re.exec(body))) {
      if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); continue; }
      const attrs = {};
      m[1].replace(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = decodeXml(a !== undefined ? a : b); });
      const r = row(attrs.text !== undefined ? attrs.text : attrs.title || '');
      for (const [k, v] of Object.entries(attrs)) {
        if (['text', 'title', 'type', 'created', 'isComment', 'isBreakpoint', 'url', 'htmlUrl', 'xmlUrl'].includes(k)) continue;
        if (k === '_note') r.note = v;
        else if (k === '_status') { r.state = v === 'checked'; doc.statusVisible = true; }
        else {
          let c = cols.get(k);
          if (!c) { c = column(k.replace(/_/g, ' ').trim(), 'text'); cols.set(k, c); raw.set(c.id, []); doc.columns.push(c); }
          r.values[c.id] = typed.has(c.id) ? parseValue(c, v) : v; raw.get(c.id).push(v);
        }
      }
      stack[stack.length - 1].children.push(r);
      if (m[2] !== '/') stack.push(r);
    }
    for (const c of doc.columns) { if (typed.has(c.id)) continue; const ty = guessType(raw.get(c.id)); if (ty !== 'text') convertColumn(doc, c, ty); }
    if (!doc.root.children.length) doc.root.children.push(row(''));
    return doc;
  }

  function toMarkdown(doc) {
    const lines = [];
    walk(doc.root, (r, d) => {
      const ind = '  '.repeat(d);
      const box = doc.statusVisible ? (statusOf(r) === 'checked' ? '[x] ' : '[ ] ') : '';
      lines.push(`${ind}- ${box}${r.text.replace(/\n/g, ' ')}`);
      if (r.note) r.note.split('\n').filter(l => l.trim()).forEach(l => lines.push(`${ind}  ${l}`));
    });
    return lines.join('\n') + '\n';
  }
  function fromMarkdown(md, title) {
    const doc = newDoc(title || 'Untitled'); doc.root.children = [];
    const heads = [{ level: 0, row: doc.root }];
    let list = [], last = null, anyBox = false;
    for (const raw of md.replace(/\r/g, '').split('\n')) {
      if (!raw.trim()) continue;
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(raw))) {
        const level = m[1].length;
        while (heads.length > 1 && heads[heads.length - 1].level >= level) heads.pop();
        const r = row(m[2].trim()); heads[heads.length - 1].row.children.push(r);
        heads.push({ level, row: r }); list = []; last = r; continue;
      }
      if ((m = /^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(raw))) {
        const indent = m[1].replace(/\t/g, '    ').length;
        let text = m[2]; const r = row('');
        const bx = /^\[([ xX])\]\s*(.*)$/.exec(text);
        if (bx) { r.state = bx[1] !== ' '; text = bx[2]; anyBox = true; }
        r.text = text;
        while (list.length && list[list.length - 1].indent >= indent) list.pop();
        (list.length ? list[list.length - 1].row : heads[heads.length - 1].row).children.push(r);
        list.push({ indent, row: r }); last = r; continue;
      }
      const line = raw.trim();
      if (last) last.note = last.note ? last.note + '\n' + line : line;
      else { last = row(line); doc.root.children.push(last); }
    }
    doc.statusVisible = anyBox;
    if (!doc.root.children.length) doc.root.children.push(row(''));
    return doc;
  }
  function fromText(text, title) {
    const md = text.replace(/\r/g, '').split('\n').filter(l => l.trim()).map(l => {
      const m = /^(\s*)(?:[-*+•]\s+)?(.*)$/.exec(l.replace(/\t/g, '    '));
      return m[1] + '- ' + m[2];
    }).join('\n');
    return fromMarkdown(md, title);
  }
  function rowsToText(rows) {
    const lines = [];
    const emit = (r, d) => { lines.push('\t'.repeat(d) + r.text.replace(/\n/g, ' ')); r.children.forEach(c => emit(c, d + 1)); };
    rows.forEach(r => emit(r, 0));
    return lines.join('\n');
  }
  function toText(doc) { return rowsToText(doc.root.children) + '\n'; }

  function toCSV(doc) {
    const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const head = ['Level', 'Topic'].concat(doc.statusVisible ? ['Status'] : [], doc.columns.map(c => c.name), ['Note']);
    const lines = [head.map(q).join(',')];
    walk(doc.root, (r, d) => {
      const cells = [String(d + 1), r.text].concat(
        doc.statusVisible ? [statusOf(r)] : [],
        doc.columns.map(c => formatValue(c, cellValue(doc, r, c).value)),
        [r.note]);
      lines.push(cells.map(q).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function toHTML(doc) {
    const cols = doc.columns.filter(c => !c.hidden);
    const paths = numberPaths(doc);
    const pre = r => doc.numbering !== 'none' ? `<span class="num">${prefix(doc.numbering, paths.get(r.id))}</span> ` : '';
    const box = r => doc.statusVisible ? (statusOf(r) === 'checked' ? '&#9745; ' : '&#9744; ') : '';
    const note = r => r.note ? `<div class="note">${escHtml(r.note).replace(/\n/g, '<br>')}</div>` : '';
    let body;
    if (cols.length) {
      const trs = [];
      walk(doc.root, (r, d) => {
        trs.push(`<tr><td style="padding-left:${d * 22 + 6}px"><span style="${styleCss(resolveStyle(doc, r, d))}">${box(r)}${pre(r)}${escHtml(r.text)}</span>${note(r)}</td>` +
          cols.map(c => `<td>${escHtml(formatValue(c, cellValue(doc, r, c).value))}</td>`).join('') + '</tr>');
      });
      body = `<table><thead><tr><th>Topic</th>${cols.map(c => `<th>${escHtml(c.name)}</th>`).join('')}</tr></thead><tbody>${trs.join('\n')}</tbody></table>`;
    } else {
      const list = (rows, d) => rows.length ? '<ul>' + rows.map(r =>
        `<li><span style="${styleCss(resolveStyle(doc, r, d))}">${box(r)}${pre(r)}${escHtml(r.text)}</span>${note(r)}${list(r.children, d + 1)}</li>`).join('\n') + '</ul>' : '';
      body = list(doc.root.children, 0);
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(doc.title)}</title><style>
body{font:15px "Segoe UI",system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#222}
ul{list-style:none;padding-left:22px}li{margin:3px 0}.note{color:#666;font-size:.9em;margin:2px 0 4px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e5e5e5;padding:4px 6px;text-align:left;vertical-align:top}th{font-size:12px;color:#666}
</style></head><body><h1>${escHtml(doc.title)}</h1>\n${body}\n</body></html>\n`;
  }

  // ---- templates ----
  const TEMPLATES = { blank: 'Blank', todo: 'To-Do List', meeting: 'Meeting Notes', budget: 'Budget', project: 'Project Plan', essay: 'Essay Outline' };
  function tree(spec) { return spec.map(s => Array.isArray(s) ? Object.assign(row(s[0]), { children: tree(s[1]) }) : row(s)); }
  function fromTemplate(key) {
    const doc = newDoc(TEMPLATES[key] || 'Untitled');
    if (key === 'todo') {
      doc.root.children = tree([['Today', ['Reply to messages', 'Plan the week']], ['Later', ['Book appointments']]]);
    } else if (key === 'meeting') {
      doc.statusVisible = false;
      doc.root.children = tree([['Attendees', ['']], ['Agenda', ['Updates', 'Discussion']], ['Decisions', ['']]]);
      doc.root.children.push(Object.assign(row('Action items'), { children: [row('')] }));
    } else if (key === 'budget') {
      doc.statusVisible = false;
      const amount = column('Amount', 'number', { summary: 'sum' });
      const cat = column('Category', 'popup', { options: ['Fixed', 'Flexible', 'Savings'] });
      doc.columns = [amount, cat];
      doc.root.children = tree([['Home', ['Rent', 'Utilities']], ['Living', ['Groceries', 'Transport']], ['Savings', ['Emergency fund']]]);
      const vals = { Rent: [1200, 'Fixed'], Utilities: [150, 'Fixed'], Groceries: [400, 'Flexible'], Transport: [90, 'Flexible'], 'Emergency fund': [300, 'Savings'] };
      walk(doc.root, r => { const v = vals[r.text]; if (v) { r.values[amount.id] = v[0]; r.values[cat.id] = v[1]; } });
    } else if (key === 'project') {
      const owner = column('Owner', 'text');
      const due = column('Due', 'date', { summary: 'max' });
      const est = column('Estimate', 'duration', { summary: 'sum' });
      const pri = column('Priority', 'popup', { options: ['High', 'Medium', 'Low'] });
      doc.columns = [owner, due, est, pri];
      doc.root.children = tree([['Plan', ['Define goals', 'Agree scope']], ['Build', ['First draft', 'Review']], ['Launch', ['Announce']]]);
      walk(doc.root, r => { if (!r.children.length) { r.values[est.id] = 4; r.values[pri.id] = 'Medium'; } });
    } else if (key === 'essay') {
      doc.statusVisible = false; doc.numbering = 'outline';
      doc.root.children = tree([['Introduction', ['Hook', 'Thesis']], ['Body', ['First point', 'Second point', 'Third point']], ['Conclusion', ['Summary']]]);
    }
    return doc;
  }

  return {
    uid, row, column, newDoc, normalize, walk, find, ancestors, contains, topLevel, allRows,
    statusOf, setStatus, visibleRows, matchRule, RULE_OPS, guessType, indent, outdent, moveUp, moveDown, deleteRows, duplicate, moveTo, insertRows, clone,
    parseDuration, formatDuration, parseValue, formatValue, cellValue, setCheckboxCell, convertColumn, sortChildren,
    prefix, numberPaths, resolveStyle, styleCss, stats,
    toOPML, fromOPML, toMarkdown, fromMarkdown, toText, fromText, rowsToText, toCSV, toHTML,
    TEMPLATES, fromTemplate, SUMMARIES, TYPES,
  };
});
