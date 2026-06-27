const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_VERSION = '4.0.0';
const APP_DIR = path.join(__dirname, 'app');
let localOrigin = '';

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json; charset=utf-8'
};

function safeFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const relative = clean || 'mobile.html';
  const resolved = path.resolve(APP_DIR, relative);
  return resolved.startsWith(path.resolve(APP_DIR)) ? resolved : null;
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let file = safeFile(req.url);
      if (!file) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.stat(file, (error, stat) => {
        if (!error && stat.isDirectory()) file = path.join(file, 'mobile.html');
        fs.readFile(file, (readError, data) => {
          if (readError) {
            res.writeHead(404, {'content-type':'text/plain'}); res.end('Not found'); return;
          }
          res.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-cache',
            'access-control-allow-origin': '*'
          });
          res.end(data);
        });
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      localOrigin = `http://127.0.0.1:${address.port}`;
      resolve(server);
    });
  });
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:','https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function createBrowserWindow(parent, targetUrl) {
  const url = validHttpUrl(targetUrl);
  if (!url) return;

  const child = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 500,
    parent,
    title: 'Arcade Browser — Website',
    backgroundColor: '#07101d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  child.removeMenu();
  child.webContents.setWindowOpenHandler(({url: next}) => {
    const allowed = validHttpUrl(next);
    if (allowed) child.loadURL(allowed);
    return {action:'deny'};
  });
  child.webContents.on('will-navigate', (event, next) => {
    if (!validHttpUrl(next)) event.preventDefault();
  });
  child.loadURL(url);
}

async function checkForUpdates(parent) {
  try {
    const response = await fetch('https://arcade-browser.netlify.app/app-version.json', {cache:'no-store'});
    if (!response.ok) return {update:false};
    const info = await response.json();

    if (String(info.version) !== APP_VERSION) {
      const result = await dialog.showMessageBox(parent, {
        type:'info',
        title:'Arcade Browser update',
        message:`Version ${info.version} is available`,
        detail:info.notes || 'A newer version is ready.',
        buttons:['Download update','Later'],
        defaultId:0,
        cancelId:1
      });
      if (result.response === 0 && info.download_url) shell.openExternal(info.download_url);
      return {update:true, version:info.version};
    }
  } catch {}
  return {update:false};
}

function createMainWindow() {
  const win = new BrowserWindow({
    width:1180,
    height:800,
    minWidth:860,
    minHeight:620,
    title:'Arcade Browser',
    backgroundColor:'#07101d',
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      partition:'persist:arcadebrowser-v4',
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true
    }
  });

  win.removeMenu();
  win.webContents.setUserAgent(
    `${win.webContents.getUserAgent()} ArcadeBrowserDesktop/4.0`
  );

  win.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith(localOrigin)) return {action:'allow'};
    if (url.startsWith('https://checkout.stripe.com/')) {
      shell.openExternal(url);
      return {action:'deny'};
    }
    const external = validHttpUrl(url);
    if (external) createBrowserWindow(win, external);
    return {action:'deny'};
  });

  win.loadURL(`${localOrigin}/mobile.html?source=desktop`);
  setTimeout(() => checkForUpdates(win), 4000);
  return win;
}

app.whenReady().then(async () => {
  await startLocalServer();

  ipcMain.handle('open-in-app', (event, url) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    createBrowserWindow(parent, url);
    return true;
  });
  ipcMain.handle('check-for-updates', (event) => {
    return checkForUpdates(BrowserWindow.fromWebContents(event.sender));
  });

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
