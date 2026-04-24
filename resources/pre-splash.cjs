const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// This file acts as a "heartbeat". If it's deleted, the splash closes.
const signalFile = path.join(os.tmpdir(), 'finances-os-active.signal');

app.whenReady().then(() => {
  // Create the signal file
  try {
    fs.writeFileSync(signalFile, 'active');
  } catch (e) {
    console.error('Failed to create signal file:', e);
  }

  const win = new BrowserWindow({
    width: 400,
    height: 450,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    title: 'Finances-OS-Splash-Window',
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const iconPath = path.join(__dirname, 'icon.png');
  let iconBase64 = '';
  try {
    const iconBuffer = fs.readFileSync(iconPath);
    iconBase64 = `data:image/png;base64,${iconBuffer.toString('base64')}`;
  } catch (e) {}

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: transparent;
            overflow: hidden;
            cursor: pointer;
          }
          .container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            background-color: #0f172a;
            color: white;
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            border-radius: 30px;
            border: 1px solid rgba(77, 240, 255, 0.3);
            box-sizing: border-box;
          }
          .logo {
            width: 160px;
            height: 160px;
            margin-bottom: 25px;
            object-fit: contain;
            filter: drop-shadow(0 0 20px rgba(77, 240, 255, 0.4));
          }
          .title {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 5px;
            letter-spacing: -0.5px;
            background: linear-gradient(180deg, #4df0ff 0%, #0055ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .status {
            font-size: 14px;
            color: #94a3b8;
            margin-top: 15px;
            height: 20px;
            font-weight: 500;
          }
          .loader {
            width: 200px;
            height: 3px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            margin-top: 25px;
            position: relative;
            overflow: hidden;
          }
          .loader::after {
            content: '';
            position: absolute;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, #4df0ff, transparent);
            animation: loading 1.8s infinite ease-in-out;
          }
          @keyframes loading {
            0% { left: -100%; }
            100% { left: 100%; }
          }
        </style>
      </head>
      <body onclick="window.close()">
        <div class="container">
          <img src="${iconBase64}" class="logo" />
          <div class="title">Finances OS</div>
          <div class="status" id="status">Starting System...</div>
          <div class="loader"></div>
        </div>
        <script>
          const msgs = ['Booting Core...', 'Syncing Database...', 'Optimizing UI...', 'Finalizing Setup...'];
          let i = 0;
          const statusEl = document.getElementById('status');
          setInterval(() => {
            statusEl.innerText = msgs[i % msgs.length];
            i++;
          }, 2000);
        </script>
      </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // SELF-DESTRUCT: If the signal file is deleted, we close instantly.
  const checkSignal = setInterval(() => {
    if (!fs.existsSync(signalFile)) {
      clearInterval(checkSignal);
      app.quit();
    }
  }, 100);

  // Safety timeout: 60s
  setTimeout(() => {
    if (fs.existsSync(signalFile)) {
      try { fs.unlinkSync(signalFile); } catch (e) {}
    }
    app.quit();
  }, 60000);
});
