import path from 'path'
import { BrowserWindow } from 'electron'

export const createSplashWindow = () => {
  const splash = new BrowserWindow({
    width: 400,
    height: 450,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const splashHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background-color: #0f172a;
            color: white;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid rgba(77, 240, 255, 0.3);
          }
          .logo-container {
            width: 180px;
            height: 180px;
            margin-bottom: 30px;
            filter: drop-shadow(0 0 15px rgba(77, 240, 255, 0.4));
          }
          .title {
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 10px;
            letter-spacing: -0.5px;
            background: linear-gradient(180deg, #4df0ff 0%, #0055ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .status {
            font-size: 14px;
            color: #94a3b8;
            margin-top: 20px;
          }
          .loader {
            width: 200px;
            height: 4px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 2px;
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
            animation: loading 1.5s infinite linear;
          }
          @keyframes loading {
            0% { left: -100%; }
            100% { left: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="logo-container">
          <img src="file://${path.join(import.meta.dirname, '../../resources/icon.png').replace(/\\/g, '/')}" width="180" height="180" />
        </div>
        <div class="title">Finances OS</div>
        <div class="status" id="status-text">Initializing Engine...</div>
        <div class="loader"></div>
        <script>
          const statuses = [
            'Waking up database...',
            'Connecting to UpWork API...',
            'Calculating daily goals...',
            'Optimizing dashboard...',
            'Readying interface...'
          ];
          let i = 0;
          const statusEl = document.getElementById('status-text');
          setInterval(() => {
            statusEl.innerText = statuses[i % statuses.length];
            i++;
          }, 1200);
        </script>
      </body>
    </html>
  `
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`)
  return splash
}
