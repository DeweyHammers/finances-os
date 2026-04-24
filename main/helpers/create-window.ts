import { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

export const createWindow = (
  options: BrowserWindowConstructorOptions,
): BrowserWindow => {
  const defaultSize = {
    width: options.width,
    height: options.height,
  };
  let state = defaultSize;

  const win = new BrowserWindow({
    ...state,
    ...options,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      ...options.webPreferences,
    },
  });

  return win;
};
