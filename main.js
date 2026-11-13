// Arbor Outliner: Windows app shell (windows, menus, files, updates).
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const SMOKE = process.argv.includes('--smoke');
const PROBE = process.argv.includes('--update-probe');
const DOC_EXT = /\.(arbor|opml|md|markdown|txt)$/i;
const FILTERS = {
  all: [{ name: 'Outlines', extensions: ['arbor', 'opml', 'md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  arbor: [{ name: 'Arbor outline', extensions: ['arbor'] }],
  opml: [{ name: 'OPML', extensions: ['opml'] }],
  markdown: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  md: [{ name: 'Markdown', extensions: ['md'] }],
  text: [{ name: 'Plain text', extensions: ['txt'] }],
  txt: [{ name: 'Plain text', extensions: ['txt'] }],
  html: [{ name: 'Web page', extensions: ['html'] }],
  csv: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
};

const wins = new Map(); // webContents id -> { win, path, dirty, force }
let settings = { recent: [], open: [] };
let quitting = false;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* first run */ } }
function saveSettings() { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* read-only profile */ } }
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function addRecent(p) {
  if (!p) return;
  settings.recent = [p, ...settings.recent.filter(x => !samePath(x, p))].slice(0, 12);
  app.addRecentDocument(p);
  saveSettings(); buildMenu();
}
function rememberOpen() {
  if (quitting || SMOKE) return;
  settings.open = [...wins.values()].map(s => s.path).filter(Boolean);
  saveSettings();
}

function createWindow(file, extra = {}) {
  if (file) {
    const open = [...wins.values()].find(s => s.path && samePath(s.path, file));
    if (open) { open.win.show(); open.win.focus(); if (extra.reveal) open.win.webContents.send('reveal', extra.reveal); return open.win; }
  }
  const focused = BrowserWindow.getFocusedWindow();
  const [x, y] = focused ? focused.getPosition().map(v => v + 26) : [];
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 640, minHeight: 420, x, y, show: !PROBE,
    title: 'Arbor Outliner', backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  const id = win.webContents.id;
  const s = { win, path: null, dirty: false, force: false };
  wins.set(id, s);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    if (file) sendFile(win, file, extra.reveal);
    else if (extra.template) win.webContents.send('menu', 'template:' + extra.template);
  });
  win.on('close', e => {
    if (s.force || !s.dirty || SMOKE) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'Do you want to save the changes to this outline?', detail: "Your changes will be lost if you don't save them.",
    });
    if (r === 0) win.webContents.send('menu', 'saveThenClose');
    else if (r === 1) { s.force = true; win.close(); }
    else quitting = false;
  });
  win.on('closed', () => { wins.delete(id); rememberOpen(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('context-menu', (_e, p) => contextMenu(win, p));
  return win;
}

function sendFile(win, file, reveal) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch (err) { dialog.showErrorBox('Could not open the file', `${file}\n\n${err.message}`); return; }
  win.webContents.send('load', { path: file, content, reveal });
  addRecent(file);
}

function contextMenu(win, p) {
  const items = p.dictionarySuggestions.slice(0, 5).map(w => ({ label: w, click: () => win.webContents.replaceMisspelling(w) }));
  if (p.misspelledWord) items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
  if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
  else if (p.selectionText) items.push({ role: 'copy' });
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------------------------------------------------------------- menus
const send = action => () => {
  const w = BrowserWindow.getFocusedWindow() || [...wins.values()][0]?.win;
  if (w) w.webContents.send('menu', action); else createWindow();
};
// Keys the outline handles itself are shown in the menu but not grabbed by it.
const item = (label, action, accelerator, opts = {}) => ({ label, click: send(action), accelerator, registerAccelerator: !opts.page, ...opts.extra });
const pageItem = (label, action, accelerator) => item(label, action, accelerator, { page: true });
const TEMPLATES = { blank: 'Blank', todo: 'To-Do List', meeting: 'Meeting Notes', budget: 'Budget', project: 'Project Plan', essay: 'Essay Outline' };

function buildMenu() {
  const recent = settings.recent.filter(p => fs.existsSync(p));
  const template = [
    { label: '&File', submenu: [
      { label: 'New', accelerator: 'Ctrl+N', click: () => createWindow() },
      { label: 'New from Template', submenu: Object.entries(TEMPLATES).map(([k, l]) => item(l, 'template:' + k)) },
      item('Open…', 'open', 'Ctrl+O'),
      { label: 'Open Recent', enabled: recent.length > 0, submenu: [
        ...recent.map(p => ({ label: p, click: () => createWindow(p) })),
        { type: 'separator' }, { label: 'Clear list', click: () => { settings.recent = []; saveSettings(); buildMenu(); } }] },
      { type: 'separator' },
      item('Save', 'save', 'Ctrl+S'),
      item('Save As…', 'saveAs', 'Ctrl+Shift+S'),
      { type: 'separator' },
      { label: 'Import', submenu: [item('OPML…', 'import:opml'), item('Markdown…', 'import:markdown'), item('Plain text…', 'import:text')] },
      { label: 'Export', submenu: [item('OPML…', 'export:opml'), item('Markdown…', 'export:markdown'), item('Plain text…', 'export:text'),
        item('Web page (HTML)…', 'export:html'), item('CSV spreadsheet…', 'export:csv'), item('PDF…', 'export:pdf')] },
      item('Print…', 'print', 'Ctrl+P'),
      { type: 'separator' },
      { label: 'Close Window', accelerator: 'Ctrl+W', click: () => BrowserWindow.getFocusedWindow()?.close() },
      { label: 'Exit', click: () => app.quit() },
    ] },
    { label: '&Edit', submenu: [
      pageItem('Undo', 'undo', 'Ctrl+Z'), pageItem('Redo', 'redo', 'Ctrl+Y'),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      pageItem('Select All', 'selectAll', 'Ctrl+A'),
      { type: 'separator' },
      pageItem('Find…', 'find', 'Ctrl+F'), pageItem('Replace…', 'replace', 'Ctrl+H'),
      pageItem('Find Next', 'findNext', 'F3'), pageItem('Find Previous', 'findPrev', 'Shift+F3'),
      { type: 'separator' },
      item('Copy Link to Row', 'copyLink'),
    ] },
    { label: '&Outline', submenu: [
      pageItem('New Row', 'newRow', 'Enter'), item('New Row Above', 'newRowAbove'), pageItem('New Child Row', 'newChild', 'Ctrl+Shift+Enter'),
      { type: 'separator' },
      pageItem('Move Right', 'indent', 'Tab'), pageItem('Move Left', 'outdent', 'Shift+Tab'),
      pageItem('Move Up', 'moveUp', 'Ctrl+Shift+Up'), pageItem('Move Down', 'moveDown', 'Ctrl+Shift+Down'),
      { type: 'separator' },
      pageItem('Check / Uncheck', 'toggleStatus', 'Ctrl+Enter'), pageItem('Add or Edit Note', 'toggleNote', "Ctrl+'"),
      pageItem('Duplicate', 'duplicate', 'Ctrl+D'), pageItem('Delete Rows', 'deleteRows', 'Ctrl+Shift+K'),
      { type: 'separator' },
      pageItem('Collapse', 'collapse', 'Alt+Left'), pageItem('Expand', 'expand', 'Alt+Right'),
      pageItem('Collapse All', 'collapseAll', 'Alt+Shift+Left'), pageItem('Expand All', 'expandAll', 'Alt+Shift+Right'),
      { type: 'separator' },
      pageItem('Focus on Selection', 'focus', 'Ctrl+Shift+F'), item('Show Entire Outline', 'unfocus'),
      { type: 'separator' },
      { label: 'Add Column', submenu: [['Text', 'text'], ['Number', 'number'], ['Duration', 'duration'], ['Date', 'date'], ['Checkbox', 'checkbox'], ['Pop-up list', 'popup']]
        .map(([l, t]) => item(l, 'addColumn:' + t)) },
    ] },
    { label: 'F&ormat', submenu: [
      pageItem('Bold', 'bold', 'Ctrl+B'), pageItem('Italic', 'italic', 'Ctrl+I'), pageItem('Underline', 'underline', 'Ctrl+U'),
      pageItem('Strikethrough', 'strike', 'Ctrl+Shift+X'), item('Clear Row Style', 'clearStyle'),
      { type: 'separator' },
      { label: 'Theme', submenu: [['Standard', 'standard'], ['Paper', 'paper'], ['Ocean', 'ocean'], ['Forest', 'forest'], ['Mono', 'mono']].map(([l, t]) => item(l, 'theme:' + t)) },
      { label: 'Appearance', submenu: [item('Match Windows', 'appearance:system'), item('Light', 'appearance:light'), item('Dark', 'appearance:dark')] },
      { label: 'Row Numbering', submenu: [item('None', 'numbering:none'), item('I. A. 1. a.', 'numbering:outline'), item('1.1.1', 'numbering:decimal'), item('1. on each level', 'numbering:simple')] },
    ] },
    { label: '&View', submenu: [
      pageItem('Sidebar', 'toggleSidebar', 'Ctrl+Shift+L'), pageItem('Inspector', 'toggleInspector', 'Ctrl+Shift+I'),
      item('Notes', 'toggleNotes'), item('Checkboxes', 'toggleStatusColumn'),
      { type: 'separator' },
      pageItem('Distraction-Free Mode', 'toggleZen', 'Ctrl+Shift+D'),
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'zoomIn', accelerator: 'Ctrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools', accelerator: 'F12' }]),
    ] },
    { label: '&Automation', submenu: [item('Automation Console…', 'automation')] },
    { label: '&Help', submenu: [
      item('Keyboard Shortcuts', 'shortcuts'),
      { label: 'Check for Updates…', click: () => checkForUpdates(true) },
      { label: 'Project Page', click: () => shell.openExternal('https://github.com/c0linzeal/arbor-outliner') },
      { type: 'separator' },
      { label: 'About Arbor Outliner', click: () => dialog.showMessageBox({ type: 'info', title: 'About', message: `Arbor Outliner ${app.getVersion()}`,
        detail: 'An outliner for Windows: rows, columns, checkboxes, styles, notes, focus and filters.' }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- automatic updates (GitHub releases)
let updater = null, manualCheck = false;
function setupUpdates() {
  if (!app.isPackaged) return;
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', info => {
    if (manualCheck) dialog.showMessageBox({ type: 'info', message: `Version ${info.version} is available.`, detail: 'It is downloading now. You will be asked to restart when it is ready.' });
  });
  updater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox({ type: 'info', message: 'Arbor Outliner is up to date.', detail: `You have version ${app.getVersion()}.` });
    manualCheck = false;
  });
  updater.on('update-downloaded', info => {
    manualCheck = false;
    const r = dialog.showMessageBoxSync({ type: 'info', buttons: ['Restart Now', 'Later'], defaultId: 0, cancelId: 1,
      message: `Arbor Outliner ${info.version} is ready to install.`, detail: 'Restart now to finish updating, or it will install the next time you quit.' });
    if (r === 0) { quitting = true; updater.quitAndInstall(); }
  });
  updater.on('error', err => {
    if (manualCheck) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates.', detail: String(err && err.message || err) });
    manualCheck = false;
  });
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);
}
function checkForUpdates(manual) {
  if (!updater) {
    if (manual) dialog.showMessageBox({ type: 'info', message: 'Updates are checked by the installed app.', detail: 'This copy is running from source.' });
    return;
  }
  manualCheck = manual;
  updater.checkForUpdates().catch(() => {});
}
// `--update-probe`: print what the update feed offers, then quit (used to verify releases).
async function updateProbe() {
  try {
    const u = require('electron-updater').autoUpdater;
    u.autoDownload = false; u.forceDevUpdateConfig = !app.isPackaged;
    const r = await u.checkForUpdates();
    console.log(`UPDATE-PROBE current=${app.getVersion()} latest=${r && r.updateInfo.version}`);
    app.exit(0);
  } catch (e) { console.log('UPDATE-PROBE error ' + e.message); app.exit(1); }
}

// ---------------------------------------------------------------- IPC
const S = e => wins.get(e.sender.id);
const W = e => BrowserWindow.fromWebContents(e.sender);
ipcMain.on('set-dirty', (e, d) => { const s = S(e); if (s) s.dirty = d; });
ipcMain.on('set-path', (e, p) => { const s = S(e); if (s) { s.path = p; if (p) addRecent(p); rememberOpen(); } });
ipcMain.on('full-screen', (e, on) => W(e)?.setFullScreen(!!on));
ipcMain.handle('open-dialog', async (e, kind) => {
  const r = await dialog.showOpenDialog(W(e), { properties: ['openFile'], filters: FILTERS[kind] || FILTERS.all });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  if (/\.arbor$/i.test(p)) addRecent(p);
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});
ipcMain.handle('save-dialog', async (e, name, kind) => {
  const s = S(e);
  const dir = s && s.path ? path.dirname(s.path) : app.getPath('documents');
  const r = await dialog.showSaveDialog(W(e), { defaultPath: path.join(dir, name), filters: FILTERS[kind] || FILTERS.all });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('write-file', async (_e, p, content) => {
  const tmp = p + '.saving';
  await fs.promises.writeFile(tmp, content, 'utf8');
  await fs.promises.rename(tmp, p); // replace in one step so a crash never leaves half a file
});
ipcMain.handle('export-pdf', async (e, name) => {
  const s = S(e);
  const r = await dialog.showSaveDialog(W(e), { defaultPath: path.join(s && s.path ? path.dirname(s.path) : app.getPath('documents'), name), filters: FILTERS.pdf });
  if (r.canceled) return null;
  const data = await e.sender.printToPDF({ printBackground: true, margins: { marginType: 'default' } });
  await fs.promises.writeFile(r.filePath, data);
  return r.filePath;
});
ipcMain.on('print', e => e.sender.print({ printBackground: true }));
ipcMain.on('open-external', (_e, url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); });
ipcMain.on('open-path', (_e, p) => { if (p && fs.existsSync(p)) shell.openPath(p); else dialog.showErrorBox('File not found', String(p)); });
ipcMain.handle('pick-files', async e => {
  const r = await dialog.showOpenDialog(W(e), { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.on('copy-text', (_e, t) => clipboard.writeText(String(t)));
ipcMain.on('new-window', (_e, template) => createWindow(null, { template }));
ipcMain.on('open-in-new-window', (_e, p) => createWindow(p));
ipcMain.on('close-window', e => { const s = S(e); if (s) { s.force = true; s.win.close(); } });

// ---------------------------------------------------------------- start-up
function openLink(url) {
  try {
    const u = new URL(url), file = u.searchParams.get('file');
    if (file && fs.existsSync(file)) createWindow(file, { reveal: u.searchParams.get('row') || undefined });
    else dialog.showErrorBox('Link not found', 'The outline this link points to could not be found.\n\n' + (file || url));
  } catch { /* not a link we understand */ }
}
function handleArgs(argv) {
  let n = 0;
  for (const a of argv) {
    if (/^arbor:/i.test(a)) { openLink(a); n++; }
    else if (DOC_EXT.test(a) && fs.existsSync(a)) { createWindow(path.resolve(a)); n++; }
  }
  return n;
}

if (!SMOKE && !PROBE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    if (!handleArgs(argv.slice(1))) { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else createWindow(); }
  });
  app.whenReady().then(() => {
    if (PROBE) return updateProbe();
    loadSettings();
    buildMenu();
    if (app.isPackaged) app.setAsDefaultProtocolClient('arbor');
    if (SMOKE) { require('./test/smoke')({ createWindow, app, wins }); return; }
    if (!handleArgs(process.argv.slice(1))) {
      const reopen = (settings.open || []).filter(p => fs.existsSync(p));
      if (reopen.length) reopen.forEach(p => createWindow(p)); else createWindow();
    }
    setupUpdates();
  });
  app.on('before-quit', () => { quitting = true; rememberOpenOnQuit(); });
  app.on('window-all-closed', () => app.quit());
}
function rememberOpenOnQuit() {
  if (SMOKE) return;
  settings.open = [...wins.values()].map(s => s.path).filter(Boolean);
  saveSettings();
}
