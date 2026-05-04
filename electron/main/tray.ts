/**
 * System tray icon + minimal context menu.
 *
 * Lives across the app lifetime. createTray() takes a getter for the main
 * window so the menu actions can show/focus it even if the window was
 * closed and recreated.
 */

import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import * as path from 'path';

let tray: Tray | null = null;

export function createTray(getMainWindow: () => BrowserWindow | null): void {
  // Use a 16x16 (mac) / 32x32 (windows) PNG. For now, use an empty image
  // as a placeholder so the build doesn't hard-fail on a missing asset.
  // Replace electron/public/tray-icon.png with a real icon before shipping.
  const iconPath = path.join(__dirname, '..', '..', 'electron', 'public', 'tray-icon.png');
  let image: Electron.NativeImage;
  try {
    image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = nativeImage.createEmpty();
  } catch {
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image);
  tray.setToolTip('Vitronitor');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        const w = getMainWindow();
        if (w) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);

  // Mac: clicking the tray brings the window forward.
  tray.on('click', () => {
    const w = getMainWindow();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
