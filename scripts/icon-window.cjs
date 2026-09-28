const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
