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

  // ---- reading Office files ----
  // Zip entries are inflated with the platform's own DecompressionStream (browser and Node).
  function unzip(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('The file is damaged or is not an Office document.');
    const entries = {}, dec = new TextDecoder();
    let p = dv.getUint32(end + 16, true);
    for (let n = dv.getUint16(end + 10, true); n > 0 && dv.getUint32(p, true) === 0x02014b50; n--) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), local = dv.getUint32(p + 42, true);
      const nl = dv.getUint16(p + 28, true), name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      entries[name] = { method, data: b.subarray(start, start + size) };
    }
    const bytesOf = async name => {
      const e = entries[name.replace(/^\//, '')];
      if (!e) return null;
      if (e.method === 0) return e.data;
      if (e.method !== 8) throw new Error('The file uses a kind of compression Arbor cannot read.');
      return inflate(e.data, 'deflate-raw');
    };
    const read = async name => { const b = await bytesOf(name); return b ? dec.decode(b) : null; };
    read.bytes = bytesOf; read.names = Object.keys(entries);
    return read;
  }
  const inflate = async (data, format) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer());
  const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
  const isGzip = b => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
  const asBytes = x => typeof x === 'string' ? new TextEncoder().encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x);
  // A small XML reader: elements are { name, attrs, kids }, text is a string.
  const unXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e) => {
    const k = e.toLowerCase();
    return k[0] === '#' ? String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k];
  });
  function parseXml(xml) {
    const root = { name: '#root', attrs: {}, kids: [] }, stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml || ''))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.kids.push(m[1]);
      else if (m[3]) {
        if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
        const el = { name: m[3], attrs: {}, kids: [] };
        m[4].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, c) => { el.attrs[k] = unXml(a !== undefined ? a : c); });
        top.kids.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] !== undefined) top.kids.push(unXml(m[6]));
    }
    return root;
  }
  const els = n => n ? n.kids.filter(k => typeof k !== 'string') : [];
  function all(n, name, out = []) { for (const k of els(n)) { if (k.name === name) out.push(k); all(k, name, out); } return out; }
  function first(n, name) { for (const k of els(n)) { if (k.name === name) return k; const f = first(k, name); if (f) return f; } return null; }
  const val = (n, a = 'w:val') => n ? n.attrs[a] : undefined;
  function readRels(xml, base) { // relationship id -> { target (full zip path), type }
    const out = {};
    for (const r of all(parseXml(xml), 'Relationship')) {
      let t = r.attrs.Target || '';
      if (r.attrs.TargetMode === 'External') continue;
      const parts = (t.startsWith('/') ? t.slice(1) : base + t).split('/'), path = [];
      for (const s of parts) { if (s === '..') path.pop(); else if (s && s !== '.') path.push(s); }
      out[r.attrs.Id] = { target: path.join('/'), type: r.attrs.Type || '' };
    }
    return out;
  }
  const relsFor = p => p.replace(/([^/]+)$/, '_rels/$1.rels');
  const dirOf = p => p.replace(/[^/]+$/, '');
  // Bullets and numbers our own exports (and many documents) put in front of a row, before a tab.
  const MARK = /^(?:[•●◦▪■☐☑☒–-]|\d+(?:\.\d+)*[.)]?|[ivxlcdm]+\.|[a-z]{1,3}\.)\t/i;
  function takeBox(text) { // "☑ Pack" -> { text: 'Pack', boxed: true, checked: true }
    const m = /^([☐☑☒])[\s\t]*/.exec(text);
    return m ? { text: text.slice(m[0].length), boxed: true, checked: m[1] !== '☐' } : { text, boxed: false, checked: false };
  }

  // Builds an outline from entries in reading order: { key, text, note?, checked?, values? }
  // where a larger key sits inside a smaller one, and { note } entries attach to the row above.
  function assemble(items, title, columns) {
    const doc = M.newDoc(title || 'Untitled'), stack = [];
    doc.root.children = []; doc.columns = columns || [];
    let last = null;
    for (const it of items) {
      if (it.kind === 'note') {
        if (last) last.note = last.note ? last.note + '\n' + it.text : it.text;
        else { last = M.row(it.text); doc.root.children.push(last); }
        continue;
      }
      const r = M.row(it.text);
      if (it.checked) r.state = true;
      if (it.values) r.values = it.values;
      while (stack.length && stack[stack.length - 1].key >= it.key) stack.pop();
      (stack.length ? stack[stack.length - 1].row : doc.root).children.push(r);
      stack.push({ key: it.key, row: r }); last = r;
    }
    doc.statusVisible = items.some(i => i.boxed);
    for (const c of doc.columns) { const ty = M.guessType(M.allRows(doc).map(r => r.values[c.id] || '')); if (ty !== 'text') M.convertColumn(doc, c, ty); }
    inferSummaries(doc);
    if (!doc.root.children.length) doc.root.children.push(M.row(''));
    return doc;
  }
  // Exports write a parent row's total (or latest date...) as a plain value. When every parent's value
  // is exactly that summary of its rows, turn the column's summary back on instead.
  function inferSummaries(doc) {
    const parents = M.allRows(doc).filter(r => r.children.length);
    for (const c of doc.columns) {
      const tries = { number: ['sum', 'max', 'min', 'avg'], duration: ['sum', 'max', 'min', 'avg'], date: ['max', 'min'] }[c.type];
      if (!tries || !parents.some(p => p.values[c.id] !== undefined)) continue;
      const own = new Map(parents.map(p => [p, p.values[c.id]]));
      parents.forEach(p => { delete p.values[c.id]; });
      const fit = tries.find(s => { c.summary = s; return parents.every(p => { const v = own.get(p), sv = M.cellValue(doc, p, c).value; return v === undefined ? sv === undefined : sv !== undefined && (typeof v === 'number' ? Math.abs(v - sv) < 1e-6 : v === sv); }); });
      if (fit) c.summary = fit;
      else { c.summary = 'none'; parents.forEach(p => { if (own.get(p) !== undefined) p.values[c.id] = own.get(p); }); }
    }
  }

  // ---- Word: headings and list levels become rows; body text becomes notes ----
  async function fromDOCX(bytes, fallbackTitle) {
    const read = unzip(bytes);
    const body = first(parseXml(await read('word/document.xml')), 'w:body');
    if (!body) throw new Error('The file has no document in it.');
    const styles = {}; // style id -> { heading, list, title }
    for (const st of all(parseXml(await read('word/styles.xml')), 'w:style')) {
      const name = (val(first(st, 'w:name')) || '').toLowerCase(), ol = val(first(st, 'w:outlineLvl'));
      const hm = /^heading\s*(\d)$/.exec(name), lm = /^list (?:bullet|number)\s*(\d)?$/.exec(name);
      styles[st.attrs['w:styleId']] = { heading: hm ? +hm[1] - 1 : ol !== undefined && +ol < 9 ? +ol : undefined,
        // "List Bullet 2" is the second level, whatever its numbering definition says
        list: lm ? (lm[1] ? +lm[1] - 1 : 0) : first(st, 'w:numPr') ? +(val(first(st, 'w:ilvl')) || 0) : undefined, title: name === 'title' };
    }
    const runText = (n, out) => {
      for (const k of els(n)) {
        if (k.name === 'w:t') out.push(k.kids.filter(x => typeof x === 'string').join(''));
        else if (k.name === 'w:tab') out.push('\t');
        else if (k.name === 'w:br' || k.name === 'w:cr') out.push('\n');
        else if (k.name === 'w:noBreakHyphen') out.push('-');
        else if (!['w:pPr', 'w:rPr', 'w:del', 'w:delText', 'w:instrText', 'w:footnoteReference', 'mc:Fallback'].includes(k.name)) runText(k, out);
      }
      return out;
    };
    const paraInfo = p => {
      const pPr = els(p).find(k => k.name === 'w:pPr'), st = styles[val(pPr && els(pPr).find(k => k.name === 'w:pStyle'))] || {};
      const numPr = pPr && first(pPr, 'w:numPr'), ind = pPr && first(pPr, 'w:ind');
      const left = +(val(ind, 'w:left') || val(ind, 'w:start') || 0);
      const outline = pPr && val(first(pPr, 'w:outlineLvl'));
      return { text: runText(p, []).join(''), heading: outline !== undefined && +outline < 9 ? +outline : st.heading, title: st.title,
        list: numPr && first(numPr, 'w:ilvl') ? +val(first(numPr, 'w:ilvl')) : st.list !== undefined ? st.list : numPr ? 0 : undefined, left };
    };
    let title = '';
    const items = [], columns = [];
    const blocks = n => els(n).flatMap(k => k.name === 'w:sdt' ? blocks(first(k, 'w:sdtContent')) : [k]);
    for (const b of blocks(body)) {
      if (b.name === 'w:p') {
        const p = paraInfo(b);
        if (!p.text.trim()) continue;
        if (p.title && !title) { title = p.text.trim(); continue; }
        if (p.heading !== undefined) { items.push({ key: p.heading, text: p.text.trim() }); continue; }
        if (p.list !== undefined || MARK.test(p.text)) {
          const bx = takeBox(p.text.replace(MARK, '').replace(/\t/g, ' ').trim());
          const lvl = p.list !== undefined ? p.list : Math.max(0, Math.round(p.left / 360) - 1);
          items.push({ key: 100 + lvl, text: bx.text, boxed: bx.boxed || /^☐|^[☑☒]/.test(p.text), checked: bx.checked || /^[☑☒]/.test(p.text) });
          continue;
        }
        items.push({ kind: 'plain', text: p.text.trim() });
      } else if (b.name === 'w:tbl') {
        // A table: the first row names the columns, the first cell of each row is the row's text
        // (indented cells, as Arbor writes them, give the level), other cells fill the columns.
        const trs = all(b, 'w:tr');
        if (!trs.length) continue;
        const cellsOf = tr => els(tr).filter(k => k.name === 'w:tc');
        const head = cellsOf(trs[0]).map(tc => all(tc, 'w:p').map(p => paraInfo(p).text).join(' ').trim());
        const cols = head.slice(1).map((n, i) => { const c = M.column(n || 'Column ' + (i + 1), 'text'); columns.push(c); return c; });
        for (const tr of trs.slice(1)) {
          const cells = cellsOf(tr); if (!cells.length) continue;
          const ps = all(cells[0], 'w:p').map(paraInfo).filter(p => p.text.trim());
          if (!ps.length && cells.slice(1).every(tc => !all(tc, 'w:p').some(p => paraInfo(p).text.trim()))) continue;
          const bx = takeBox((ps[0] ? ps[0].text : '').trim());
          const values = {};
          cols.forEach((c, i) => { const v = cells[i + 1] ? all(cells[i + 1], 'w:p').map(p => paraInfo(p).text).join('\n').trim() : ''; if (v) values[c.id] = v; });
          items.push({ key: 200 + Math.round((ps[0] ? ps[0].left : 0) / 280), text: bx.text, boxed: bx.boxed, checked: bx.checked, values });
          if (ps.length > 1) items.push({ kind: 'note', text: ps.slice(1).map(p => p.text.trim()).join('\n') });
        }
      }
    }
    // With headings or lists, plain paragraphs are notes on the row above; a plain document gets a row per paragraph.
    const structured = items.some(i => i.kind !== 'plain');
    for (const it of items) if (it.kind === 'plain') { if (structured) it.kind = 'note'; else { delete it.kind; it.key = 0; } }
    if (!title) title = ((await read('docProps/core.xml') || '').match(/<dc:title>([^<]*)<\/dc:title>/) || [])[1] || '';
    return assemble(items, unXml(title).trim() || fallbackTitle, columns);
  }

  // ---- PowerPoint: each slide is a row, its bullets are rows inside it, speaker notes become its note ----
  async function fromPPTX(bytes, fallbackTitle) {
    const read = unzip(bytes);
    const pres = parseXml(await read('ppt/presentation.xml'));
    if (!first(pres, 'p:presentation')) throw new Error('The file has no presentation in it.');
    const presRels = readRels(await read('ppt/_rels/presentation.xml.rels'), 'ppt/');
    const slides = all(pres, 'p:sldId').map(s => presRels[s.attrs['r:id']]).filter(Boolean).map(r => r.target);
    const paras = sp => all(first(sp, 'p:txBody'), 'a:p').map(p => {
      const pPr = els(p).find(k => k.name === 'a:pPr');
      const out = [];
      const walk = n => { for (const k of els(n)) { if (k.name === 'a:t') out.push(k.kids.filter(x => typeof x === 'string').join('')); else if (k.name === 'a:br') out.push('\n'); else if (k.name === 'a:tab') out.push('\t'); else if (k.name !== 'a:pPr' && k.name !== 'a:rPr') walk(k); } };
      walk(p);
      const marL = pPr && pPr.attrs.marL !== undefined ? +pPr.attrs.marL : null;
      const lvl = pPr && pPr.attrs.lvl !== undefined ? +pPr.attrs.lvl : marL ? Math.max(0, Math.round(marL / 342900) - 1) : 0;
      const bu = pPr && first(pPr, 'a:buChar');
      return { text: out.join(''), lvl, none: !!(pPr && first(pPr, 'a:buNone')), char: bu ? bu.attrs.char : '' };
    }).filter(p => p.text.trim());
    const items = [];
    let title = '';
    for (let i = 0; i < slides.length; i++) {
      const path = slides[i], x = parseXml(await read(path));
      if (!first(x, 'p:sld')) continue;
      let head = '', sub = '', isCover = false;
      const body = [];
      for (const sp of all(x, 'p:sp')) {
        const ph = first(first(sp, 'p:nvSpPr'), 'p:ph'), type = ph ? ph.attrs.type || 'body' : '';
        const name = val(first(sp, 'p:cNvPr'), 'name') || '';
        if (['sldNum', 'dt', 'ftr', 'hdr'].includes(type)) continue;
        const ps = paras(sp); if (!ps.length) continue;
        if (type === 'title' || type === 'ctrTitle' || (!ph && /^title/i.test(name) && !head)) {
          if (!head) head = ps.map(p => p.text.trim()).join(' ');
          if (type === 'ctrTitle') isCover = true;
        } else if (type === 'subTitle') sub = ps.map(p => p.text.trim()).join('\n');
        else body.push(...ps);
      }
      if (!head && body.length) head = body.shift().text.trim();
      if (!head) continue;
      // The first slide is the cover when it is a title slide or has nothing but a title.
      if (i === 0 && !title && (isCover || !body.length)) { title = head; if (sub) items.push({ kind: 'note-cover', text: sub }); continue; }
      items.push({ key: 0, text: head });
      for (const p of body) {
        if (p.none) { items.push({ kind: 'note', text: p.text.trim() }); continue; }
        const bx = takeBox((p.char && /[☐-☒]/.test(p.char) ? p.char + ' ' : '') + p.text.replace(MARK, '').trim());
        items.push({ key: 1 + p.lvl, text: bx.text, boxed: bx.boxed, checked: bx.checked });
      }
      if (sub) items.push({ kind: 'note', text: sub });
      // Speaker notes
      const notes = Object.values(readRels(await read(relsFor(path)), dirOf(path))).find(r => /\/notesSlide$/.test(r.type));
      if (notes) {
        const nx = parseXml(await read(notes.target));
        const text = all(nx, 'p:sp').filter(sp => { const ph = first(sp, 'p:ph'); return ph && (ph.attrs.type || 'body') === 'body'; })
          .flatMap(paras).map(p => p.text.trim()).join('\n');
        if (text) {
          const slideRow = items.filter(it => it.key === 0 && it.kind === undefined).pop();
          slideRow.note = slideRow.note ? slideRow.note + '\n' + text : text;
        }
      }
    }
    const doc = assemble(items.filter(it => it.kind !== 'note-cover'), title || fallbackTitle);
    // Speaker notes go on the slide rows (assemble only knows notes that follow a row).
    const slideNotes = items.filter(it => it.key === 0 && it.kind === undefined).map(it => it.note || '');
    doc.root.children.forEach((r, i) => { if (slideNotes[i]) r.note = r.note ? r.note + '\n' + slideNotes[i] : slideNotes[i]; });
    return doc;
  }

  // ---- OmniOutliner (.ooutline from version 5 on, .oo3 from versions 3 and 4) ----
  // A file may be a zip (flat .ooutline, or a zipped package), gzipped XML, or plain XML.
  const local = n => n.replace(/^[\w.-]+:/, '');
  const textOf = n => n.kids.map(k => typeof k === 'string' ? k : '').join('');
  const richText = n => n ? all(n, 'p').map(p => all(p, 'lit').map(textOf).join('')).join('\n').replace(/\s+$/, '') : '';
  const isoDay = v => { // OmniOutliner dates are timestamps; keep the day as the person saw it
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = new Date(s);
    if (isNaN(t)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  };
  const OO_TYPES = { text: 'text', number: 'number', date: 'date', duration: 'duration', checkbox: 'checkbox', enumeration: 'popup', popup: 'popup' };
  const OO_SUMMARY = { sum: 'sum', total: 'sum', average: 'avg', minimum: 'min', maximum: 'max', hidden: 'hidden', none: 'none', state: 'state' };
  async function fromOmniOutliner(input, fallbackTitle) {
    let b = asBytes(input), password = false;
    if (isZip(b)) {
      const read = unzip(b);
      const name = read.names.find(n => /(^|\/)contents\.xml$/i.test(n) && !/__MACOSX/.test(n));
      password = !name && read.names.some(n => /encrypt/i.test(n));
      b = name ? await read.bytes(name) : new Uint8Array(0);
    }
    if (isGzip(b)) b = await inflate(b, 'gzip');
    const xml = new TextDecoder().decode(b);
    if (!/omnigroup\.com\/namespace\/OmniOutliner/.test(xml.slice(0, 4000)))
      throw new Error(password ? 'This OmniOutliner document is password-protected. Remove the password in OmniOutliner, then open it again.'
        : 'Arbor could not find an outline in this file. If it is password-protected, remove the password in OmniOutliner first.');
    const tree = parseXml(xml);
    (function strip(n) { for (const k of els(n)) { k.name = local(k.name); strip(k); } })(tree);
    const outline = first(tree, 'outline');
    const colsEl = els(outline).find(k => k.name === 'columns');
    const ids = colsEl ? colsEl.attrs : {};
    const cols = els(colsEl).filter(k => k.name === 'column').map((c, i) => ({
      id: c.attrs.id || ':' + i, type: c.attrs.type || 'text', summary: c.attrs.summary,
      title: richText(els(c).find(k => k.name === 'title')).trim(),
      outline: c.attrs['is-outline-column'] === 'yes' || c.attrs.id === ids['outline-column'],
      note: c.attrs['is-note-column'] === 'yes' || c.attrs.id === ids['note-column'],
      status: !!ids['status-column'] && c.attrs.id === ids['status-column'],
      members: Object.fromEntries(all(c, 'member').map(m => [m.attrs.id, richText(m) || m.attrs.name || m.attrs.title || ''])),
    }));
    if (!cols.some(c => c.outline)) { const t = cols.find(c => !c.note && !c.status && c.type === 'text'); if (t) t.outline = true; }
    const doc = M.newDoc(richText(els(outline).find(k => k.name === 'outline-title')).trim() || fallbackTitle || 'Untitled');
    doc.root.children = [];
    const extra = new Map(); // OmniOutliner column -> Arbor column
    for (const c of cols) {
      if (c.outline || c.note || c.status) continue;
      const ac = M.column(c.title || 'Column', OO_TYPES[c.type] || 'text', { summary: OO_SUMMARY[c.summary] || 'none' });
      if (!M.SUMMARIES[ac.type].includes(ac.summary)) ac.summary = 'none';
      ac.options = Object.values(c.members).filter(Boolean);
      doc.columns.push(ac); extra.set(c, ac);
    }
    const cell = (el, c) => { // one cell's value, as Arbor stores it
      if (!el || el.name === 'null' || (el.name === 'entry' && !els(el).length)) return undefined;
      if (el.name === 'entry') el = els(el)[0];
      const idref = el.attrs.idref;
      if (idref !== undefined) return c.members[idref] || undefined;
      const t = el.name === 'text' ? richText(el) : textOf(el).trim();
      if (t === '') return undefined;
      const ac = extra.get(c);
      if (!ac) return t;
      if (ac.type === 'date') return isoDay(t);
      if (ac.type === 'checkbox') return t === 'checked';
      if (ac.type === 'duration' && /^-?\d+(\.\d+)?$/.test(t)) return Math.round(+t / 3600 * 1000) / 1000; // stored in seconds
      return M.parseValue(ac, t);
    };
    let anyState = false;
    const fill = (r, values, state) => { // values: cell elements in column order
      cols.forEach((c, i) => {
        const v = values[i];
        if (c.outline) r.text = v ? (v.name === 'text' ? richText(v) : textOf(v).trim()) : '';
        else if (c.note) { const n = v ? richText(v.name === 'entry' ? els(v)[0] : v) : ''; if (n) r.note = n; }
        else if (c.status) state = v ? textOf(v).trim() : state;
        else { const x = cell(v, c); if (x !== undefined) r.values[extra.get(c).id] = x; }
      });
      if (state === 'checked' || state === 'indeterminate') anyState = true;
      r.state = state === 'checked';
    };
    const items = els(outline).find(k => k.name === 'items');
    if (items) {
      // Version 5: a flat list; each item names its parent and its place among its siblings (rank).
      const list = els(items).filter(k => k.name === 'item');
      const rootItem = list.find(k => k.attrs['is-root'] === 'yes');
      const kids = new Map(), rows = new Map();
      for (const it of list) {
        if (it === rootItem) continue;
        const r = M.row('');
        fill(r, els(it).filter(k => k.name !== 'style'), 'unchecked');
        rows.set(it.attrs.id, r);
        const parent = it.attrs['parent-id'] && it.attrs['parent-id'] !== (rootItem && rootItem.attrs.id) ? it.attrs['parent-id'] : '';
        if (!kids.has(parent)) kids.set(parent, []);
        kids.get(parent).push({ rank: it.attrs.rank || '', row: r });
      }
      const order = (a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
      for (const [pid, list2] of kids) {
        const parent = pid ? rows.get(pid) : doc.root;
        (parent || doc.root).children.push(...list2.sort(order).map(x => x.row));
      }
    } else {
      // Versions 3 and 4: items nest inside each other; the note is separate from the columns.
      const valueCols = cols.filter(c => !c.note);
      const build = it => {
        const r = M.row('');
        const vals = els(els(it).find(k => k.name === 'values'));
        const byCol = cols.map(c => c.note ? null : vals[valueCols.indexOf(c)]);
        fill(r, byCol, it.attrs.state || 'unchecked');
        const note = els(it).find(k => k.name === 'note');
        if (note) r.note = richText(note);
        r.collapsed = it.attrs.expanded === 'no' ? true : it.attrs.expanded === 'yes' ? false : els(it).some(k => k.name === 'children');
        r.children = els(els(it).find(k => k.name === 'children')).filter(k => k.name === 'item').map(build);
        if (!r.children.length) r.collapsed = false;
        return r;
      };
      const rootEl = els(outline).find(k => k.name === 'root');
      doc.root.children = els(rootEl).filter(k => k.name === 'item').map(build);
    }
    doc.statusVisible = anyState;
    if (!doc.root.children.length) doc.root.children.push(M.row(''));
    return doc;
  }

  // ---- spreadsheets (Excel and CSV): a row per line; Level, Status and Note columns are understood ----
  function fromTable(table, title, levels) {
    const at = table.findIndex(r => r.some(v => v !== '' && v != null));
    if (at < 0) return assemble([], title, []);
    const head = table[at].map(v => String(v == null ? '' : v).trim()), body = table.slice(at + 1), lv = levels ? levels.slice(at + 1) : null;
    const str = v => v == null ? '' : typeof v === 'boolean' ? (v ? 'checked' : 'unchecked') : String(v).trim();
    const colVals = i => body.map(r => str(r[i])).filter(Boolean);
    const named = re => head.findIndex(n => re.test(n));
    let level = named(/^(level|depth|outline level)$/i);
    if (level >= 0 && !colVals(level).every(v => /^\d+$/.test(v) && +v >= 1)) level = -1;
    let status = named(/^(status|done|checked|complete)$/i);
    if (status >= 0 && !colVals(status).every(v => /^(checked|unchecked|mixed|yes|no|true|false|x|done|)$/i.test(v))) status = -1;
    const note = named(/^notes?$/i);
    let topic = named(/^(topic|title|task|item|name|row)$/i);
    if (topic < 0) topic = head.findIndex((_, i) => ![level, status, note].includes(i));
    if (topic < 0) topic = 0;
    const columns = [], colOf = new Map();
    head.forEach((n, i) => { if (![level, status, note, topic].includes(i)) { const c = M.column(n || 'Column ' + (i + 1), 'text'); columns.push(c); colOf.set(i, c); } });
    const items = [];
    body.forEach((r, k) => {
      if (!r.some(v => str(v) !== '')) return;
      const values = {};
      for (const [i, c] of colOf) { const v = str(r[i]); if (v) values[c.id] = v; }
      const st = status >= 0 ? str(r[status]).toLowerCase() : '';
      items.push({ key: level >= 0 ? +str(r[level]) || 1 : lv ? lv[k] || 0 : 0, text: str(r[topic]), values,
        boxed: status >= 0, checked: /^(checked|yes|true|x|done)$/.test(st) });
      if (note >= 0 && str(r[note])) items.push({ kind: 'note', text: str(r[note]) });
    });
    return assemble(items, title, columns);
  }
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"' && field === '') q = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  const fromCSV = (text, title) => fromTable(parseCSV(text), title);

  async function fromXLSX(bytes, title) {
    const read = unzip(asBytes(bytes));
    const parse = async name => { const t = parseXml(await read(name)); (function strip(n) { for (const k of els(n)) { k.name = local(k.name); strip(k); } })(t); return t; };
    const wb = await parse('xl/workbook.xml');
    const sheet = first(wb, 'sheet');
    if (!sheet) throw new Error('The workbook has no sheets in it.');
    const target = (readRels(await read('xl/_rels/workbook.xml.rels'), 'xl/')[sheet.attrs['r:id']] || {}).target || 'xl/worksheets/sheet1.xml';
    const shared = all(await parse('xl/sharedStrings.xml'), 'si').map(si => {
      const out = [];
      const walk = n => { for (const k of els(n)) { if (k.name === 't') out.push(textOf(k)); else if (k.name !== 'rPh' && k.name !== 'phoneticPr') walk(k); } };
      walk(si); return out.join('');
    });
    // Which cell styles are dates, and how far each indents (Arbor's own export indents the topic by level)
    const styles = await parse('xl/styles.xml');
    const custom = Object.fromEntries(all(styles, 'numFmt').map(f => [f.attrs.numFmtId, f.attrs.formatCode || '']));
    const isDateFmt = id => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58) ||
      (custom[id] !== undefined && /[dmy]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^[hms:.\s0#,]*$/i.test(custom[id]));
    const xfs = els(first(styles, 'cellXfs')).filter(k => k.name === 'xf').map(xf => ({ date: isDateFmt(+xf.attrs.numFmtId), indent: +(val(first(xf, 'alignment'), 'indent') || 0) }));
    const colNum = ref => { let n = 0; for (const ch of (/^[A-Z]+/.exec(ref) || [''])[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const table = [], outline = [], indent = [];
    for (const row of all(await parse(target), 'row')) {
      const ri = row.attrs.r ? +row.attrs.r - 1 : table.length;
      const cells = []; let next = 0, ind = 0;
      for (const c of els(row).filter(k => k.name === 'c')) {
        const ci = c.attrs.r ? colNum(c.attrs.r) : next; next = ci + 1;
        const v = els(c).find(k => k.name === 'v'), t = c.attrs.t, xf = xfs[+c.attrs.s || 0] || {};
        let x = v ? textOf(v) : '';
        if (t === 's') x = shared[+x] || '';
        else if (t === 'inlineStr') x = all(c, 't').map(textOf).join('');
        else if (t === 'b') x = x === '1';
        else if (t !== 'str' && t !== 'e' && x !== '') {
          const n = +x;
          x = xf.date && !isNaN(n) ? new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5)).toISOString().slice(0, 10) : n;
        }
        if (ci === 0) ind = xf.indent;
        cells[ci] = x;
      }
      table[ri] = cells; outline[ri] = +(row.attrs.outlineLevel || 0); indent[ri] = ind;
    }
    for (let i = 0; i < table.length; i++) if (!table[i]) { table[i] = []; outline[i] = 0; indent[i] = 0; }
    const levels = indent.some(Boolean) ? indent : outline.some(Boolean) ? outline : null;
    return fromTable(table, title, levels);
  }

  return { zip, crc32, toXLSX, toDOCX, toPPTX, toRTF, fromRTF, fromDOCX, fromPPTX, fromOmniOutliner, fromXLSX, fromCSV, parseCSV, unzip, parseXml };
});
