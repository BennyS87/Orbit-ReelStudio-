// Orbit - Electron main process
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let isDirty = false;
let forceClose = false;
let pendingOpenPath = null; // file passed on launch / via Finder

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#05090c',
    title: 'Orbit',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) { openProjectPath(pendingOpenPath); pendingOpenPath = null; }
  });

  win.on('close', (e) => {
    if (!isDirty || forceClose) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0, cancelId: 2,
      message: 'Save changes to your Orbit project before closing?'
    });
    if (choice === 2) { e.preventDefault(); return; }
    if (choice === 0) {
      e.preventDefault();
      win.webContents.send('menu', 'save-then-close');
      return;
    }
    // Don't save
  });

  win.on('closed', () => { win = null; });

  // open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  buildMenu();
}

function send(cmd) { if (win) win.webContents.send('menu', cmd); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save Project As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: 'Export MP3…', accelerator: 'CmdOrCtrl+E', click: () => send('export-mp3') },
        { label: 'Export WAV…', click: () => send('export-wav') },
        { label: 'Export MIDI…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export-midi') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { type: 'separator' },
        { label: 'Copy Sound', accelerator: 'CmdOrCtrl+Alt+C', click: () => send('copy-sound') },
        { label: 'Paste Sound', accelerator: 'CmdOrCtrl+Alt+V', click: () => send('paste-sound') },
        { type: 'separator' },
        { label: 'Clear All Notes', click: () => send('clear') }
      ]
    },
    {
      label: 'Transport',
      submenu: [
        { label: 'Play / Stop', accelerator: 'Space', registerAccelerator: false, click: () => send('toggle-play') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Orbit on GitHub', click: () => shell.openExternal('https://github.com/') }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openProjectPath(p) {
  try {
    const content = fs.readFileSync(p, 'utf8');
    if (win) win.webContents.send('open-project', { path: p, content });
  } catch (err) {
    dialog.showErrorBox('Could not open project', String(err));
  }
}

// ---------- IPC ----------
ipcMain.handle('save-file', async (_e, { defaultPath, filters, data, encoding, path: knownPath }) => {
  let target = knownPath;
  if (!target) {
    const res = await dialog.showSaveDialog(win, { defaultPath, filters });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  const buf = encoding === 'binary' ? Buffer.from(data) : data;
  fs.writeFileSync(target, buf);
  return target;
});

ipcMain.handle('open-file', async (_e, { filters }) => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (res.canceled || !res.filePaths.length) return null;
  const p = res.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

ipcMain.handle('confirm', async (_e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons: buttons || ['OK', 'Cancel'], defaultId: 0, cancelId: (buttons || ['OK', 'Cancel']).length - 1 });
  return r.response;
});

ipcMain.on('set-dirty', (_e, dirty) => { isDirty = !!dirty; });
ipcMain.on('set-title', (_e, title) => { if (win) win.setTitle(title); });
ipcMain.on('close-now', () => { forceClose = true; if (win) win.close(); });
ipcMain.on('reveal', (_e, p) => { shell.showItemInFolder(p); });

// ---------- App lifecycle ----------
app.on('open-file', (e, p) => { // macOS double-click .orbit
  e.preventDefault();
  if (win && !win.webContents.isLoading()) openProjectPath(p); else pendingOpenPath = p;
});

const argFile = process.argv.find(a => a.endsWith('.orbit'));
if (argFile) pendingOpenPath = argFile;

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
