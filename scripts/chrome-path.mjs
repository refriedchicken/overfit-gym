// Find a Chrome-family browser for the headless scripts. CHROME_PATH wins;
// otherwise the usual install locations on macOS, Windows and Linux are tried.
// Returns null when none is found.

import fs from 'node:fs';
import path from 'node:path';

const MAC = ['Google Chrome', 'Chromium', 'Microsoft Edge'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
const WIN_DIRS = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
const WIN = WIN_DIRS.flatMap((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')]);

const onPath = (name) =>
  (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, name))
    .find((p) => fs.existsSync(p));

export function findChrome() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  if (process.platform === 'darwin') return MAC.find((p) => fs.existsSync(p)) ?? null;
  if (process.platform === 'win32') return WIN.find((p) => fs.existsSync(p)) ?? null;
  for (const name of LINUX_NAMES) {
    const hit = onPath(name);
    if (hit) return hit;
  }
  return null;
}
