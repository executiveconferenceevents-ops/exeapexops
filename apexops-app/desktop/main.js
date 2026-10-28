const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const BUILD_DIR = path.join(__dirname, '..', 'build');

// A standard secure scheme keeps the build's absolute /static paths and localStorage working offline.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1B2A4A',
    title: 'APEXOPS',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://apexops/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  protocol.handle('app', request => {
    const { pathname } = new URL(request.url);
    const target = path.normalize(path.join(BUILD_DIR, decodeURIComponent(pathname)));
    if (!target.startsWith(BUILD_DIR)) return new Response('Forbidden', { status: 403 });
    const fallback = path.join(BUILD_DIR, 'index.html');
    return net.fetch(pathToFileURL(path.extname(target) ? target : fallback).toString())
      .catch(() => net.fetch(pathToFileURL(fallback).toString()));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
