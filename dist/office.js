// Office exports (Excel, Word, PowerPoint) and RTF, written by hand so the app needs no
// extra libraries. Office files are zip packages of XML; entries are stored uncompressed,
// which every Office reader accepts.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.Office = factory(root.Model);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  // ---- zip (store only) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) { // files: { 'path/in/zip': string }
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const [name, text] of Object.entries(files)) {
      const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      // version 20, flag 0x0800 (UTF-8 names), method 0 (store), time/date fixed at 1980-01-01
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(33), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
      const local = Uint8Array.from([...u32(0x04034b50), ...common]);
      parts.push(local, nm, data);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
      offset += local.length + nm.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0), n = Object.keys(files).length;
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  const x = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // characters XML forbids
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const rels = list => XML + `<Relationships xmlns="${PKG}">` + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') + '</Relationships>';
  const hex = c => (c || '').replace('#', '').toUpperCase();
  const box = (doc, r) => doc.statusVisible ? (M.statusOf(r) === 'checked' ? '☑ ' : '☐ ') : '';
  function rowsWithDepth(doc) { const out = []; M.walk(doc.root, (r, d) => { out.push({ r, d }); }); return out; }
  const pre = (doc, r, paths) => doc.numbering !== 'none' ? M.prefix(doc.numbering, paths.get(r.id)) + ' ' : '';

  // ---- Excel ----
  function excelDate(iso) { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; }
  function colName(i) { let s = ''; i++; while (i) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); } return s; }
  function toXLSX(doc) {
    const cols = doc.columns.filter(c => !c.hidden);
    const head = ['Topic'].concat(doc.statusVisible ? ['Status'] : [], cols.map(c => c.name), ['Note']);
    // Styles: 0 normal, 1 header, 2 date, 3+k indented topic at level k (bold for level-styled bold rows uses +16)
    const LEVELS = 15;
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
      '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'];
    for (let b = 0; b < 2; b++) for (let k = 0; k <= LEVELS; k++)
      xfs.push(`<xf numFmtId="0" fontId="${b}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment indent="${k}" wrapText="1" vertical="top"/></xf>`);
    const topicStyle = (d, bold) => 3 + (bold ? LEVELS + 1 : 0) + Math.min(d, LEVELS);
    const cell = (ref, v, s) => {
      if (v === undefined || v === null || v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
      if (typeof v === 'number') return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"${s ? ` s="${s}"` : ''}><v>${v ? 1 : 0}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    };
    const rowsXml = [`<row r="1">${head.map((t, i) => cell(colName(i) + 1, t, 1)).join('')}</row>`];
    const paths = M.numberPaths(doc);
    let n = 1, maxDepth = 0;
    for (const { r, d } of rowsWithDepth(doc)) {
      n++; maxDepth = Math.max(maxDepth, d);
      const st = M.resolveStyle(doc, r, d), cells = [];
      let i = 0;
      cells.push(cell(colName(i++) + n, pre(doc, r, paths) + r.text, topicStyle(d, st.bold)));
      if (doc.statusVisible) cells.push(cell(colName(i++) + n, M.statusOf(r), 0));
      for (const c of cols) {
        const v = M.cellValue(doc, r, c).value, ref = colName(i++) + n;
        if (c.type === 'number') cells.push(cell(ref, typeof v === 'number' ? v : undefined));
        else if (c.type === 'date' && v) cells.push(cell(ref, excelDate(v), 2));
        else if (c.type === 'checkbox') cells.push(cell(ref, v === 'mixed' ? 'mixed' : v === undefined ? undefined : !!v));
        else cells.push(cell(ref, M.formatValue(c, v)));
      }
      cells.push(cell(colName(i++) + n, r.note));
      // outlineLevel lets Excel group (collapse/expand) rows like the outline
      rowsXml.push(`<row r="${n}"${d ? ` outlineLevel="${Math.min(d, 7)}"` : ''}>${cells.join('')}</row>`);
    }
    const widths = [60].concat(doc.statusVisible ? [12] : [], cols.map(c => Math.max(10, Math.round(c.width / 7))), [50]);
    const sheet = XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '">' +
      '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' +
      `<dimension ref="A1:${colName(head.length - 1)}${n}"/>` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${Math.min(maxDepth, 7)}"/>` +
      '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      `<autoFilter ref="A1:${colName(head.length - 1)}${n}"/>` +
      '</worksheet>';
    const sheetName = x((doc.title || 'Outline').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Outline');
    return zip({
      '[Content_Types].xml': XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
      'xl/workbook.xml': XML + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${colName(head.length - 1)}$${n}</definedName></definedNames></workbook>`,
      'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'styles', 'styles.xml']]),
      'xl/styles.xml': XML + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml': sheet,
    });
  }

  // ---- Word ----
  function runProps(st, extra = '') {
    let p = '';
    if (st.fontFamily) p += `<w:rFonts w:ascii="${x(st.fontFamily)}" w:hAnsi="${x(st.fontFamily)}" w:cs="${x(st.fontFamily)}"/>`;
    if (st.bold) p += '<w:b/>'; if (st.italic) p += '<w:i/>'; if (st.strike) p += '<w:strike/>';
    if (st.color) p += `<w:color w:val="${hex(st.color)}"/>`;
    if (st.fontSize) p += `<w:sz w:val="${Math.round(st.fontSize * 1.5)}"/>`; // px to half-points (15px ~ 11pt)
    if (st.highlight) p += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(st.highlight)}"/>`;
    if (st.underline) p += '<w:u w:val="single"/>';
    return '<w:rPr>' + p + extra + '</w:rPr>';
  }
  const wRun = (text, rpr) => String(text).split('\n').map((line, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r>${rpr}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`).join('');
  function toDOCX(doc) {
    const cols = doc.columns.filter(c => !c.hidden), paths = M.numberPaths(doc), body = [];
    body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${wRun(doc.title || 'Outline', '<w:rPr/>')}</w:p>`);
    const topicPara = (r, d, indent) => {
      const st = Object.assign({}, M.resolveStyle(doc, r, d)); delete st.lineHeight;
      const bullet = doc.numbering !== 'none' ? M.prefix(doc.numbering, paths.get(r.id)) : (box(doc, r) || '• ').trim();
      let s = `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${indent ? `<w:ind w:left="${360 * d + 360}" w:hanging="360"/>` : ''}</w:pPr>`;
      s += wRun((indent ? bullet + '\t' : box(doc, r) + pre(doc, r, paths)) + r.text, runProps(st)) + '</w:p>';
      if (r.note) s += `<w:p><w:pPr><w:spacing w:after="60"/>${indent ? `<w:ind w:left="${360 * d + 360}"/>` : ''}</w:pPr>${wRun(r.note, '<w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr>')}</w:p>`;
      return s;
    };
    if (!cols.length) {
      for (const { r, d } of rowsWithDepth(doc)) body.push(topicPara(r, d, true));
    } else {
      const total = 9360, first = Math.max(3000, total - cols.length * 1500), rest = Math.floor((total - first) / cols.length);
      const tc = (w, inner, shade) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr>${inner}</w:tc>`;
      const para = (t, rpr = '<w:rPr/>', ind = 0) => `<w:p>${ind ? `<w:pPr><w:ind w:left="${ind}"/></w:pPr>` : ''}${wRun(t, rpr)}</w:p>`;
      let t = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>`).join('') +
        `</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="${first}"/>${cols.map(() => `<w:gridCol w:w="${rest}"/>`).join('')}</w:tblGrid>`;
      t += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + tc(first, para('Topic', '<w:rPr><w:b/></w:rPr>'), true) + cols.map(c => tc(rest, para(c.name, '<w:rPr><w:b/></w:rPr>'), true)).join('') + '</w:tr>';
      for (const { r, d } of rowsWithDepth(doc)) {
        const st = Object.assign({}, M.resolveStyle(doc, r, d)); delete st.lineHeight;
        let inner = para(box(doc, r) + pre(doc, r, paths) + r.text, runProps(st), d * 280);
        if (r.note) inner += para(r.note, '<w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr>', d * 280);
        t += '<w:tr>' + tc(first, inner) + cols.map(c => tc(rest, para(M.formatValue(c, M.cellValue(doc, r, c).value)))).join('') + '</w:tr>';
      }
      body.push(t + '</w:tbl><w:p/>');
    }
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    return zip({
      '[Content_Types].xml': XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
      'word/_rels/document.xml.rels': rels([['rId1', 'styles', 'styles.xml']]),
      'word/styles.xml': XML + `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>` +
        '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>',
      'word/document.xml': XML + `<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body.join('')}` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1270" w:right="1270" w:bottom="1270" w:left="1270" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>',
    });
  }

  // ---- PowerPoint: a title slide, then one slide per top-level row with its rows as bullets ----
  function toPPTX(doc) {
    const P = 'http://schemas.openxmlformats.org/presentationml/2006/main', A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const NS = `xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}"`;
    const CX = 12192000, CY = 6858000;
    const para = (text, lvl, opts = {}) => {
      const rpr = `<a:rPr lang="en-US" sz="${opts.size || (lvl ? 2000 : 2400)}" dirty="0"${opts.bold ? ' b="1"' : ''}${opts.italic ? ' i="1"' : ''}${opts.strike ? ' strike="sngStrike"' : ''}>` +
        (opts.color ? `<a:solidFill><a:srgbClr val="${hex(opts.color)}"/></a:solidFill>` : '') + '</a:rPr>';
      const bullet = opts.bullet === false ? '<a:buNone/>' : `<a:buFont typeface="Arial"/><a:buChar char="${opts.char || '•'}"/>`;
      return `<a:p><a:pPr marL="${opts.bullet === false ? 0 : 342900 + lvl * 342900}" indent="${opts.bullet === false ? 0 : -342900}">${bullet}</a:pPr><a:r>${rpr}<a:t>${x(text)}</a:t></a:r></a:p>`;
    };
    const shape = (id, name, x0, y0, w, hgt, paras, anchor = 't') =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${w}" cy="${hgt}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras.join('') || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`;
    const slideXml = shapes => XML + `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const slides = [];
    slides.push(slideXml(shape(2, 'Title', 838200, 2130000, CX - 1676400, 1470000, [para(doc.title || 'Outline', 0, { size: 4400, bold: true, bullet: false })], 'ctr')));
    const mark = r => doc.statusVisible ? (M.statusOf(r) === 'checked' ? '☑' : '☐') : '•';
    for (const top of doc.root.children) {
      const body = [];
      if (top.note) body.push(para(top.note, 0, { size: 1800, italic: true, color: '#666666', bullet: false }));
      M.walk(top, (r, d) => {
        if (d > 7) return;
        const st = M.resolveStyle(doc, r, d + 1);
        body.push(para(r.text, d, { bold: st.bold, italic: st.italic, strike: st.strike, color: st.color, char: mark(r) }));
      });
      slides.push(slideXml(shape(2, 'Title', 838200, 365125, CX - 1676400, 1325563, [para(top.text || ' ', 0, { size: 3600, bold: true, bullet: false })], 'b') +
        shape(3, 'Content', 838200, 1825625, CX - 1676400, 4351338, body)));
    }
    const theme = XML + `<a:theme xmlns:a="${A}" name="Arbor"><a:themeElements><a:clrScheme name="Arbor">` +
      '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
      ['2F6FDE', 'C2410C', '3F7D34', '0F7EA8', 'B0602A', '6B21A8'].map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('') +
      '<a:hlink><a:srgbClr val="2F6FDE"/></a:hlink><a:folHlink><a:srgbClr val="6B21A8"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="Arbor"><a:majorFont><a:latin typeface="Segoe UI Semibold"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Arbor"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
    const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
    const files = {
      '[Content_Types].xml': XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>',
      '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
      'ppt/presentation.xml': XML + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
        `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>` +
        `<p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'],
        ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]),
      'ppt/slideMasters/slideMaster1.xml': XML + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld>` +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]),
      'ppt/slideLayouts/slideLayout1.xml': XML + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
      'ppt/theme/theme1.xml': theme,
    };
    slides.forEach((s, i) => {
      files[`ppt/slides/slide${i + 1}.xml`] = s;
      files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]);
    });
    return zip(files);
  }

  // ---- RTF ----
  const rtfEsc = s => String(s).replace(/[\\{}]/g, m => '\\' + m).replace(/\n/g, '\\line ')
    .replace(/[^\x00-\x7f]/g, ch => { const c = ch.codePointAt(0); return c > 0xffff ? ch.split('').map(u => `\\u${u.charCodeAt(0) - (u.charCodeAt(0) > 32767 ? 65536 : 0)}?`).join('') : `\\u${c > 32767 ? c - 65536 : c}?`; });
  function toRTF(doc) {
    const colors = ['#000000', '#666666'], ci = c => { if (!c) return 0; let i = colors.indexOf(c.toLowerCase()); if (i < 0) { colors.push(c.toLowerCase()); i = colors.length - 1; } return i + 1; };
    const paths = M.numberPaths(doc), cols = doc.columns.filter(c => !c.hidden), out = [];
    out.push(`{\\pard\\sa240\\fs40\\b ${rtfEsc(doc.title || 'Outline')}\\b0\\par}`);
    for (const { r, d } of rowsWithDepth(doc)) {
      const st = M.resolveStyle(doc, r, d);
      const fmt = (st.bold ? '\\b' : '') + (st.italic ? '\\i' : '') + (st.underline ? '\\ul' : '') + (st.strike ? '\\strike' : '') + (st.color ? `\\cf${ci(st.color)}` : '');
      const mark = doc.numbering !== 'none' ? M.prefix(doc.numbering, paths.get(r.id)) : doc.statusVisible ? (M.statusOf(r) === 'checked' ? '☑' : '☐') : '•';
      const vals = cols.map(c => [c.name, M.formatValue(c, M.cellValue(doc, r, c).value)]).filter(v => v[1]);
      out.push(`{\\pard\\li${360 * d + 360}\\fi-360\\sa60 ${rtfEsc(mark)}\\tab {${fmt} ${rtfEsc(r.text)}}` +
        (vals.length ? `{\\cf2  (${rtfEsc(vals.map(v => v[0] + ': ' + v[1]).join(', '))})}` : '') + '\\par}');
      if (r.note) out.push(`{\\pard\\li${360 * d + 360}\\sa60\\i\\cf2 ${rtfEsc(r.note)}\\par}`);
    }
    const table = '{\\colortbl;' + colors.map(c => { const n = parseInt(c.slice(1), 16); return `\\red${n >> 16}\\green${(n >> 8) & 255}\\blue${n & 255};`; }).join('') + '}';
    return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Segoe UI;}}${table}\\f0\\fs22\n${out.join('\n')}\n}\n`;
  }
  // Reads an RTF file as an outline: paragraph indents (\li) and leading tabs give the levels.
  function fromRTF(rtf, title) {
    const paras = []; let cur = { text: '', li: 0 }, depth = 0; const skipAt = [];
    const stack = []; let li = 0, uc = 1, skip = 0;
    const re = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/gi;
    let m;
    const emit = ch => { if (skip > 0) { skip--; return; } if (!skipAt.length) cur.text += ch; };
    while ((m = re.exec(rtf))) {
      if (m[5] === '{') { stack.push({ li, uc }); depth++; continue; }
      if (m[5] === '}') { if (skipAt.length && skipAt[skipAt.length - 1] === depth) skipAt.pop(); depth--; const s = stack.pop(); if (s) ({ li, uc } = s); continue; }
      if (m[6] !== undefined) { if (skip > 0) { const t = m[6].slice(Math.min(skip, m[6].length)); skip = Math.max(0, skip - m[6].length); if (!skipAt.length) cur.text += t; } else if (!skipAt.length) cur.text += m[6]; continue; }
      if (m[3]) { emit(String.fromCharCode(parseInt(m[3], 16))); continue; }
      if (m[4]) { if (m[4] === '*') skipAt.push(depth); else if ('\\{}'.includes(m[4])) emit(m[4]); else if (m[4] === '~') emit(' '); continue; }
      if (!m[1]) continue;
      const w = m[1].toLowerCase(), n = m[2] === undefined ? null : +m[2];
      if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', 'generator'].includes(w)) { skipAt.push(depth); continue; }
      if (w === 'par' || w === 'row') { if (!skipAt.length) { cur.li = li; paras.push(cur); } cur = { text: '', li: 0 }; continue; }
      if (w === 'pard') { li = 0; continue; }
      if (w === 'li') { li = n || 0; continue; }
      if (w === 'uc') { uc = n || 0; continue; }
      if (w === 'u') { emit(String.fromCharCode(n < 0 ? n + 65536 : n)); skip = uc; continue; }
      if (w === 'tab') { emit('\t'); continue; }
      if (w === 'line') { emit('\n'); continue; }
      if (w === 'cell') { emit(' '); continue; }
      if (['emdash', 'endash'].includes(w)) { emit('-'); continue; }
      if (['lquote', 'rquote'].includes(w)) { emit("'"); continue; }
      if (['ldblquote', 'rdblquote'].includes(w)) { emit('"'); continue; }
      if (w === 'bullet') { emit('•'); continue; }
    }
    if (cur.text.trim()) { cur.li = li; paras.push(cur); }
    const MARK = /^(?:[•●◦☐☑☒-]|\d+(?:\.\d+)*[.)]?|[ivxlcdm]+\.|[a-z]+\.)\t/i;
    const lines = paras.filter(p => p.text.trim()).map(p => {
      const t = p.text.replace(/^[ ]+/, ''), tabs = (/^\t*/.exec(t) || [''])[0].length, body = t.slice(tabs);
      const marked = MARK.test(body), checked = /^[☑☒]/.test(body), boxed = /^[☐☑☒]/.test(body);
      const text = body.replace(MARK, '').replace(/\t/g, ' ').trim();
      return { level: Math.max(0, Math.round(p.li / 360) - (p.li >= 360 ? 1 : 0)) + tabs, text, checked, boxed, marked };
    });
    // In a bulleted document, an unbulleted paragraph is the note of the row above it.
    const bulleted = lines.some(l => l.marked), doc = M.newDoc(title || 'Untitled'), rows = [];
    doc.root.children = []; doc.statusVisible = lines.some(l => l.boxed);
    for (const l of lines) {
      const prev = rows[rows.length - 1];
      if (bulleted && !l.marked && !prev) { doc.title = l.text; continue; }
      if (bulleted && !l.marked && prev) { prev.row.note = prev.row.note ? prev.row.note + '\n' + l.text : l.text; continue; }
      const r = M.row(l.text); r.state = l.checked;
      while (rows.length && rows[rows.length - 1].level >= l.level) rows.pop();
      (rows.length ? rows[rows.length - 1].row : doc.root).children.push(r);
      rows.push({ level: l.level, row: r });
    }
    if (!doc.root.children.length) doc.root.children.push(M.row(''));
    return doc;
  }

  return { zip, crc32, toXLSX, toDOCX, toPPTX, toRTF, fromRTF };
});
