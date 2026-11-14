'use strict';

const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, clipboard, ClipboardItem,
  dialog, screen, desktopCapturer, Notification, nativeTheme, shell
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const stateModule = require('./state');
const helper = require('./helper');
const ai = require('./ai');
const { ClipboardWatcher, textSignature, imageSignature } = require('./clipboard-watcher');
const { defaultState } = require('./seed');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PRELOAD = path.join(__dirname, 'preload.js');
const IS_DEV = !app.isPackaged;

let data = null;
let tray = null;
let quitting = false;
let fgWatch = null;
let externalForeground = 0;
let watcher = null;
let shortcutErrors = {};
let aiContext = { type: 'none' };
let aiRestoreView = 'panel';
let aiRequests = new Map();
let shotState = null;
let captureView = '';

const windows = {};
const petWindows = new Map();
const recentViews = [];
const initiallyPlaced = new Set();
const VIEW_SIZES = {
  launcher: { w: 620, h: 480, margin: 30 },
  aiHub: { w: 580, h: 700, margin: 30 },
  aiPrefs: { w: 640, h: 680, margin: 30 },
  clip: { w: 580, h: 700, margin: 30 },
  petSettings: { w: 700, h: 740, margin: 30 },
  aiDialog: { w: 580, h: 760, margin: 26 }
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    showPanel({ remember: false });
  });
}

if (process.argv.some(function (arg) { return arg.indexOf('--capture=') === 0; })) {
  const arg = process.argv.find(function (item) { return item.indexOf('--capture=') === 0; });
  captureView = arg.split('=')[1] || '';
}

/* ==================== 基础工具 ==================== */
function uid(prefix) {
  return stateModule.uid(prefix);
}

function clientState() {
  const out = stateModule.toClient(data);
  out.meta = { shortcutErrors: Object.assign({}, shortcutErrors) };
  return out;
}

function broadcast(channel, payload, exclude) {
  BrowserWindow.getAllWindows().forEach(function (win) {
    if (win.isDestroyed()) return;
    if (exclude && win.webContents === exclude) return;
    win.webContents.send(channel, payload);
  });
}

function broadcastState(exclude) {
  broadcast('state:changed', clientState(), exclude);
}

function sendWhenReady(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', function () {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    });
  } else {
    win.webContents.send(channel, payload);
  }
}

function nativeHandle(win) {
  try {
    const buffer = win.getNativeWindowHandle();
    if (buffer.length >= 8) return Number(buffer.readBigUInt64LE(0));
    return buffer.readUInt32LE(0);
  } catch (err) {
    return 0;
  }
}

function isToolboxWindow(win) {
  return !!win && BrowserWindow.getAllWindows().indexOf(win) >= 0;
}

function toolboxHandles() {
  return BrowserWindow.getAllWindows().map(nativeHandle);
}

function isOurHandle(hwnd) {
  return toolboxHandles().indexOf(hwnd) >= 0;
}

/* 托盘菜单、开始菜单、通知中心这类窗口只活一瞬间，记下来会让粘贴找不到目标 */
const SHELL_CLASSES = [
  'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', '#32768', 'ForegroundStaging',
  'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame', 'TaskSwitcherWnd'
];

function isShellForeground(hwnd, className) {
  if (!hwnd) return true;
  if (className && SHELL_CLASSES.indexOf(className) >= 0) return true;
  return false;
}

function currentView() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    const match = Object.keys(windows).find(function (view) { return windows[view] === focused; });
    if (match) return match;
  }
  for (const view of recentViews) {
    const recent = windows[view];
    if (recent && !recent.isDestroyed() && recent.isVisible()) return view;
  }
  const order = ['aiDialog', 'petSettings', 'clip', 'aiPrefs', 'aiHub', 'launcher', 'panel'];
  for (let i = 0; i < order.length; i++) {
    const win = windows[order[i]];
    if (win && !win.isDestroyed() && win.isVisible()) return order[i];
  }
  return '';
}

function displayForCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function centerWindow(win) {
  const bounds = win.getBounds();
  const area = displayForCursor().workArea;
  win.setPosition(
    Math.round(area.x + (area.width - bounds.width) / 2),
    Math.round(area.y + (area.height - bounds.height) / 2)
  );
}

function cascadeWindow(win) {
  const bounds = win.getBounds();
  const area = displayForCursor().workArea;
  const visibleCount = BrowserWindow.getAllWindows().filter(function (item) {
    return item !== win && item.isVisible();
  }).length;
  const offset = Math.min(5, visibleCount) * 24;
  win.setPosition(
    Math.round(Math.max(area.x + 12, area.x + (area.width - bounds.width) / 2 + offset)),
    Math.round(Math.max(area.y + 12, area.y + (area.height - bounds.height) / 2 + offset))
  );
}

function placeAiDialog(win) {
  const bounds = win.getBounds();
  const area = displayForCursor().workArea;
  const x = Math.max(area.x + 12, area.x + area.width - bounds.width - 52);
  const y = Math.max(area.y + 12, area.y + Math.round(area.height * 0.1));
  win.setPosition(Math.round(x), Math.round(y));
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: title, body: body, silent: false }).show();
    }
  } catch (err) { /* ignore */ }
}

/* ==================== 窗口 ==================== */
function viewSize(view) {
  if (view === 'panel') {
    const area = displayForCursor().workArea;
    return {
      w: Math.min(data.settings.panelW + 60, area.width - 16),
      h: Math.min(data.settings.panelH + 60, area.height - 16),
      margin: 30
    };
  }
  const size = VIEW_SIZES[view] || VIEW_SIZES.launcher;
  const area = displayForCursor().workArea;
  return {
    w: Math.min(size.w + size.margin * 2, area.width - 16),
    h: Math.min(size.h + size.margin * 2, area.height - 16),
    margin: size.margin
  };
}

function ensureView(view) {
  const existing = windows[view];
  if (existing && !existing.isDestroyed()) return existing;

  const size = viewSize(view);
  const win = new BrowserWindow({
    width: size.w,
    height: size.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    acceptFirstMouse: true,
    alwaysOnTop: view === 'aiDialog' ||
      (view === 'panel' && !!data.settings.pin) ||
      (view === 'clip' && !!data.settings.clipPin),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  win.setMenu(null);
  win.webContents.setWindowOpenHandler(function () { return { action: 'deny' }; });
  win.webContents.on('will-navigate', function (event) { event.preventDefault(); });

  win.loadFile(path.join(SRC, 'index.html'), { query: { view: view } });
  win.on('focus', function () {
    const index = recentViews.indexOf(view);
    if (index >= 0) recentViews.splice(index, 1);
    recentViews.unshift(view);
  });

  win.on('closed', function () {
    delete windows[view];
  });

  win.webContents.on('before-input-event', function (event, input) {
    if (IS_DEV && input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  windows[view] = win;
  return win;
}

function hideAllMain(except) {
  ['panel', 'launcher', 'aiHub', 'aiPrefs', 'clip', 'petSettings', 'aiDialog'].forEach(function (view) {
    if (view === except) return;
    const win = windows[view];
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  });
}

/* 等页面首帧画完再显示，避免透明窗口先露出背景再补内容造成闪跳 */
function showWhenReady(win) {
  if (!win || win.isDestroyed()) return;
  let shown = false;
  const reveal = function () {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
    if (typeof win.moveTop === 'function') win.moveTop();
    win.focus();
  };
  if (win.webContents.isLoading()) {
    win.once('ready-to-show', reveal);
    win.webContents.once('did-finish-load', reveal);
  } else {
    reveal();
  }
}

function showView(view) {
  if (view === 'pet') {
    view = 'petSettings';
  }
  if (view === 'pets') view = 'petSettings';
  if (view === 'ai') view = 'aiHub';
  if (view === 'aiSettings' || view === 'presets') view = 'aiPrefs';
  if (view === 'main') view = 'panel';
  if (!['panel', 'launcher', 'aiHub', 'aiPrefs', 'clip', 'petSettings', 'aiDialog'].includes(view)) {
    view = 'launcher';
  }

  const win = ensureView(view);
  hideAllMain(view);
  if (view === 'panel') {
    applyPanelWindowSize();
    if (!win.isVisible()) centerWindow(win);
  } else if (view === 'aiDialog') {
    if (!initiallyPlaced.has(view)) {
      placeAiDialog(win);
      initiallyPlaced.add(view);
    }
  } else if (!win.isVisible() && !initiallyPlaced.has(view)) {
    cascadeWindow(win);
    initiallyPlaced.add(view);
  }
  showWhenReady(win);
  if (view === 'aiDialog') sendWhenReady(win, 'ai:context', clientAiContext());
  return win;
}

function hideView(view) {
  const win = windows[view];
  if (win && !win.isDestroyed()) win.hide();
}

function applyPanelWindowSize() {
  const win = windows.panel;
  if (!win || win.isDestroyed()) return;
  const size = viewSize('panel');
  const bounds = win.getBounds();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const x = Math.round(cx - size.w / 2);
  const y = Math.round(cy - size.h / 2);
  win.setBounds({ x: x, y: y, width: size.w, height: size.h });
  win.webContents.send('panel:size-changed', {
    w: Math.round(size.w - 60),
    h: Math.round(size.h - 60)
  });
}

function rememberForeground() {
  if (externalForeground) return externalForeground;
  helper.foregroundInfo().then(function (info) {
    if (!info) return;
    if (isOurHandle(info.hwnd) || isShellForeground(info.hwnd, info.className)) return;
    externalForeground = info.hwnd;
  });
  return externalForeground;
}

function showPanel(options) {
  const opts = options || {};
  const win = ensureView('panel');
  if (win.isVisible() && win.isFocused() && opts.toggle !== false) {
    win.hide();
    return;
  }
  rememberForeground();
  hideAllMain('panel');
  applyPanelWindowSize();
  if (!win.isVisible() || opts.recenter === true) centerWindow(win);
  showWhenReady(win);
}

function hidePanel() {
  const win = windows.panel;
  if (win && !win.isDestroyed() && win.isVisible()) {
    /* 先主动让出焦点，系统会把前台还给用户刚才的窗口，再隐藏 */
    try { win.blur(); } catch (e) { /* ignore */ }
  }
  hideView('panel');
}

function openSettings(section) {
  const win = ensureView('panel');
  hideAllMain('panel');
  showPanel({ remember: false, toggle: false });
  sendWhenReady(win, 'nav:settings', { section: section || '' });
}

function closeAiDialog(restore) {
  hideView('aiDialog');
  aiRequests.forEach(function (controller) { try { controller.abort(); } catch (e) { /* ignore */ } });
  aiRequests.clear();
  if (restore === false) return;
  const target = aiRestoreView || 'panel';
  if (target === 'aiDialog') {
    showView('panel');
    return;
  }
  showView(target);
}

function openAI(context, restoreView) {
  if (context) aiContext = context;
  if (restoreView) aiRestoreView = restoreView;
  const current = currentView();
  if (current && current !== 'aiDialog') aiRestoreView = current;

  const win = ensureView('aiDialog');
  hideAllMain('aiDialog');
  if (!initiallyPlaced.has('aiDialog')) {
    placeAiDialog(win);
    initiallyPlaced.add('aiDialog');
  }
  win.show();
  win.focus();
  sendWhenReady(win, 'ai:context', clientAiContext());
}

function clientAiContext() {
  if (!aiContext || aiContext.type === 'none') return { type: 'none' };
  if (aiContext.type === 'image') {
    return {
      type: 'image',
      url: aiContext.url,
      width: aiContext.width,
      height: aiContext.height
    };
  }
  return { type: 'text', text: String(aiContext.text || '').slice(0, 6000) };
}

/* ==================== 全局快捷键 ==================== */
function toAccelerator(combo) {
  if (!combo) return '';
  const parts = String(combo).split('+').map(function (part) { return part.trim(); }).filter(Boolean);
  if (!parts.length) return '';
  const mapped = parts.map(function (part) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') return 'Control';
    if (lower === 'meta' || lower === 'super' || lower === 'cmd') return 'Super';
    if (lower === 'alt' || lower === 'option') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (lower === 'space' || lower === 'spacebar') return 'Space';
    if (lower === 'arrowup') return 'Up';
    if (lower === 'arrowdown') return 'Down';
    if (lower === 'arrowleft') return 'Left';
    if (lower === 'arrowright') return 'Right';
    if (lower === 'escape' || lower === 'esc') return 'Escape';
    if (lower === 'enter' || lower === 'return') return 'Enter';
    if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
    return part;
  });
  return mapped.join('+');
}

async function handleSelectHotkey() {
  if (windows.aiDialog && windows.aiDialog.isVisible() && windows.aiDialog.isFocused()) return;
  watcher.suspend(2500);
  const text = await captureSelection();
  openAI({ type: text ? 'text' : 'none', text: text || '' }, currentView());
}

async function captureSelection() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && isToolboxWindow(focused)) {
    try {
      const value = await focused.webContents.executeJavaScript(
        '(function(){var ae=document.activeElement;if(ae&&(ae.tagName==="TEXTAREA"||ae.tagName==="INPUT")&&typeof ae.selectionStart==="number"&&ae.selectionEnd>ae.selectionStart){return String(ae.value||"").slice(ae.selectionStart,ae.selectionEnd);}var s=window.getSelection();return s?String(s.toString()||""):"";})()'
      );
      const text = String(value || '').trim();
      if (text) return text.slice(0, 4000);
    } catch (err) { /* ignore */ }
    return '';
  }
  const text = await helper.selection();
  return String(text || '').trim().slice(0, 4000);
}

function startScreenshot() {
  if (shotState) return;
  const restore = currentView() || 'panel';
  hideAllMain();
  watcher.suspend(1500);

  setTimeout(async function () {
    try {
      const displays = screen.getAllDisplays();
      const maxW = Math.min(2560, Math.max.apply(null, displays.map(function (d) { return d.size.width * d.scaleFactor; })));
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(maxW), height: Math.round(maxW * 0.75) },
        fetchWindowIcons: false
      });

      const overlays = [];
      const images = new Map();

      displays.forEach(function (display, index) {
        let source = sources.find(function (item) { return String(item.display_id) === String(display.id); });
        if (!source && sources[index]) source = sources[index];
        if (!source) return;
        const thumb = source.thumbnail;
        if (!thumb || thumb.isEmpty()) return;

        const imageSize = thumb.getSize();
        images.set(display.id, { image: thumb, imageSize: imageSize, display: display });

        const win = new BrowserWindow({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          movable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          fullscreenable: false,
          focusable: true,
          show: false,
          hasShadow: false,
          webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false
          }
        });

        win.setMenu(null);
        win.loadFile(path.join(SRC, 'shot.html'), { query: { i: String(index), id: String(display.id) } });
        win.once('ready-to-show', function () {
          win.show();
          win.focus();
        });
        sendWhenReady(win, 'shot:image', {
          url: thumb.toDataURL(),
          width: display.bounds.width,
          height: display.bounds.height,
          imageWidth: imageSize.width,
          imageHeight: imageSize.height,
          label: '拖拽框选要提问的区域'
        });
        overlays.push(win);
      });

      shotState = { overlays: overlays, images: images, restore: restore };
      if (!overlays.length) {
        shotState = null;
        notify('截图失败', '没有拿到屏幕画面，请重试。');
        showView(restore);
      }
    } catch (err) {
      shotState = null;
      notify('截图失败', err.message || '无法读取屏幕');
      showView(restore);
    }
  }, 260);
}

function closeShotOverlays() {
  if (!shotState) return;
  shotState.overlays.forEach(function (win) {
    if (win && !win.isDestroyed()) win.close();
  });
  shotState = null;
}

function confirmShot(payload) {
  if (!shotState) return;
  const displayId = String(payload.displayId);
  const entry = shotState.images.get(displayId) || shotState.images.get(Number(displayId));
  const restore = shotState.restore;
  if (!entry) {
    closeShotOverlays();
    showView(restore);
    return;
  }

  const rect = payload.rect || {};
  const scaleX = entry.imageSize.width / entry.display.bounds.width;
  const scaleY = entry.imageSize.height / entry.display.bounds.height;
  const x = Math.max(0, Math.round(rect.x * scaleX));
  const y = Math.max(0, Math.round(rect.y * scaleY));
  const w = Math.max(1, Math.round(rect.w * scaleX));
  const h = Math.max(1, Math.round(rect.h * scaleY));

  const cropped = entry.image.crop({
    x: Math.min(x, entry.imageSize.width - 1),
    y: Math.min(y, entry.imageSize.height - 1),
    width: Math.min(w, entry.imageSize.width - x),
    height: Math.min(h, entry.imageSize.height - y)
  });

  const buffer = cropped.toPNG();
  const file = path.join(stateModule.tmpDir, 'shot-' + Date.now() + '.png');
  fs.writeFileSync(file, buffer);

  closeShotOverlays();
  openAI({
    type: 'image',
    file: file,
    url: pathToFileURL(file).href,
    imageDataUrl: 'data:image/png;base64,' + buffer.toString('base64'),
    width: Math.round(rect.w),
    height: Math.round(rect.h)
  }, restore);
}

function cancelShot() {
  if (!shotState) return;
  const restore = shotState.restore;
  closeShotOverlays();
  showView(restore || 'panel');
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutErrors = {};

  const bindings = [
    { key: 'panel', handler: function () { showPanel(); } },
    { key: 'select', handler: function () { handleSelectHotkey(); } },
    { key: 'shot', handler: function () { startScreenshot(); } },
    { key: 'clipboard', handler: function () {
      const win = windows.clip;
      if (win && win.isVisible() && win.isFocused()) win.hide();
      else showView('clip');
    } }
  ];

  bindings.forEach(function (binding) {
    const accelerator = toAccelerator(data.settings.hotkeys[binding.key]);
    if (!accelerator) return;
    try {
      const ok = globalShortcut.register(accelerator, binding.handler);
      if (!ok) shortcutErrors[binding.key] = '快捷键被其他程序占用';
    } catch (err) {
      shortcutErrors[binding.key] = '快捷键格式不被系统支持';
    }
  });
}

/* ==================== 剪贴板 ==================== */
/* Electron 45 的剪贴板改成了异步 Web 风格 API：readText/writeText/read/write */
async function writeTextToClipboard(text) {
  try {
    watcher.suspend(900);
    const value = String(text == null ? '' : text);
    await clipboard.writeText(value);
    watcher.mark(textSignature(value));
    return true;
  } catch (err) {
    return false;
  }
}

async function writeImageToClipboard(ref) {
  try {
    const value = String(ref || '');
    let buffer = null;
    if (/^data:image\/png;base64,/i.test(value)) {
      buffer = Buffer.from(value.split(',')[1], 'base64');
    } else if (/^data:image\/svg/i.test(value)) {
      /* SVG 交给渲染端先转 PNG；这里拿不到位图 */
      return false;
    } else {
      const file = stateModule.resolveRef(value);
      if (file && fs.existsSync(file)) buffer = fs.readFileSync(file);
    }
    if (!buffer || !buffer.length) return false;
    const item = new ClipboardItem({ 'image/png': new Blob([buffer], { type: 'image/png' }) });
    watcher.suspend(900);
    await clipboard.write([item]);
    watcher.mark(imageSignature(buffer));
    return true;
  } catch (err) {
    return false;
  }
}

function addClipEntry(payload, source) {
  if (!payload) return false;
  const type = payload.type === 'image' ? 'image' : 'text';
  const content = type === 'image' ? '' : String(payload.content || '').slice(0, 20000);
  const sig = type === 'image' && payload.buffer
    ? imageSignature(payload.buffer)
    : payload.sig || textSignature(content);
  /* 同一内容只保留一份；再次使用历史记录不挪位置、不生成新记录。 */
  if (data.clipboard.some(function (item) {
    if (item.type !== type) return false;
    if (type === 'image' && !/^i:\d+:[a-f0-9]{40}$/.test(item.sig || '')) {
      try {
        const buffer = /^data:image\/png;base64,/i.test(item.image || '')
          ? Buffer.from(item.image.split(',')[1], 'base64')
          : stateModule.readRefAsBuffer(item.image);
        if (buffer && buffer.length) item.sig = imageSignature(buffer);
      } catch (err) { /* 旧图片不可读取时，继续保留记录。 */ }
    }
    return item.type === type && (item.sig === sig || (type === 'text' && !item.sig && item.content === content));
  })) return false;

  let imageRef = '';
  if (payload.type === 'image') {
    if (!payload.buffer || payload.buffer.length > 12 * 1024 * 1024) return false;
    imageRef = stateModule.saveImageBuffer(payload.buffer, 'media/clipboard', uid('clip'));
  }

  const entry = {
    id: uid('c'),
    type: payload.type === 'image' ? 'image' : 'text',
    content: payload.type === 'image' ? '' : String(payload.content || '').slice(0, 20000),
    image: imageRef,
    source: source || '监听',
    sig: sig,
    createdAt: Date.now()
  };

  data.clipboard.unshift(entry);
  if (data.clipboard.length > 40) {
    const removed = data.clipboard.splice(40);
    removed.forEach(function (item) { stateModule.deleteRef(item.image); });
  }
  stateModule.save(data);
  broadcastState();
  return true;
}

function addClipboardFiles(files, source) {
  let added = false;
  (files || []).forEach(function (file) {
    if (!file) return;
    const buffer = fs.readFileSync(file);
    if (buffer.length > 12 * 1024 * 1024) return;
    added = addClipEntry({ type: 'image', buffer: buffer, sig: 'i:' + file + ':' + buffer.length }, source || '手动') || added;
  });
  return added;
}

function pasteIntoPrevious() {
  const target = externalForeground;
  setTimeout(async function () {
    let result = false;
    try {
      result = await helper.pasteTo(target, process.pid);
    } catch (err) {
      result = false;
    }
    if (result === 'self') {
      watcher.suspend(1200);
      notify('已复制到剪贴板', '前台还是工具箱自己的窗口，已跳过自动粘贴。');
      return;
    }
    if (result === 'nofocus') {
      watcher.suspend(1200);
      notify('已复制到剪贴板', '没能回到刚才的输入框，已复制好，切回去按 Ctrl+V 即可。');
      return;
    }
    if (!result) {
      watcher.suspend(1200);
      notify('已复制到剪贴板', '自动粘贴没有成功，请在目标窗口按 Ctrl+V。');
    }
  }, 30);
}

/* ==================== 桌宠 ==================== */
let petSeq = { id: 0, pending: new Map(), timers: new Set() };
let lastClip = {};

function petById(id) {
  return data.pets.find(function (pet) { return pet.id === id; }) || null;
}

function clientPet(pet) {
  return stateModule.toClient(data).pets.find(function (item) { return item.id === pet.id; });
}

function petWindowSize(pet) {
  return { w: Math.round(pet.size) + 16, h: Math.round(pet.size) + 104 };
}

function defaultPetPosition(pet, index) {
  const area = displayForCursor().workArea;
  const size = petWindowSize(pet);
  const baseX = area.x + area.width - size.w - 34;
  const baseY = area.y + area.height - size.h - 26;
  const step = Math.round(pet.size) + 14;
  let x = baseX - index * step;
  if (x < area.x + 10) x = area.x + 10 + (index % 3) * 26;
  return { x: Math.round(x), y: Math.round(baseY) };
}

function createPetWindow(pet) {
  if (petWindows.has(pet.id)) return petWindows.get(pet.id);
  const size = petWindowSize(pet);
  const area = displayForCursor().workArea;
  const fallback = defaultPetPosition(pet, pet.order || 0);
  let x = Number.isFinite(pet.x) ? pet.x : fallback.x;
  let y = Number.isFinite(pet.y) ? pet.y : fallback.y;
  x = Math.min(Math.max(area.x, x), Math.max(area.x, area.x + area.width - size.w));
  y = Math.min(Math.max(area.y, y), Math.max(area.y, area.y + area.height - size.h));

  const win = new BrowserWindow({
    x: Math.round(x),
    y: Math.round(y),
    width: size.w,
    height: size.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  win.setMenu(null);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(SRC, 'pet.html'), { query: { pet: pet.id } });
  let revealed = false;
  function revealPetWindow() {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    win.showInactive();
    /* 透明桌宠窗口在部分全屏/置顶程序后面会掉层，显示后再抬一次 */
    win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof win.moveTop === 'function') win.moveTop();
  }
  win.once('ready-to-show', revealPetWindow);
  win.webContents.on('did-finish-load', revealPetWindow);
  win.on('closed', function () { petWindows.delete(pet.id); });
  petWindows.set(pet.id, win);
  sendWhenReady(win, 'pet:init', {
    pet: clientPet(pet),
    paused: !!data.settings.petPaused || !!pet.paused
  });
  return win;
}

function destroyPetWindow(id) {
  const win = petWindows.get(id);
  if (win && !win.isDestroyed()) win.close();
  petWindows.delete(id);
}

function syncPetWindows() {
  if (!data.settings.petEnabled) {
    Array.from(petWindows.keys()).forEach(destroyPetWindow);
    return;
  }
  if (data.pets.length && !data.pets.some(function (pet) { return pet.enabled; })) {
    data.pets[0].enabled = true;
    stateModule.save(data);
  }
  const alive = {};
  data.pets.forEach(function (pet, index) {
    pet.order = index;
    alive[pet.id] = true;
    if (!pet.enabled) {
      destroyPetWindow(pet.id);
      return;
    }
    const existed = petWindows.has(pet.id);
    const win = createPetWindow(pet);
    if (existed && win && !win.isDestroyed()) {
      win.webContents.send('pet:init', {
        pet: clientPet(pet),
        paused: !!data.settings.petPaused || !!pet.paused
      });
    }
  });
  Array.from(petWindows.keys()).forEach(function (id) {
    if (!alive[id]) destroyPetWindow(id);
  });
}

function pickClip(pet, mode, clipId) {
  const enabled = (pet.clips || []).filter(function (clip) { return clip.enabled; });
  if (!enabled.length) return null;
  if (mode === 'fixed' && clipId) {
    const fixed = enabled.find(function (clip) { return clip.id === Number(clipId); });
    if (fixed) return fixed;
  }
  if (enabled.length === 1) return enabled[0];
  const last = lastClip[pet.id];
  const pool = enabled.filter(function (clip) { return clip.id !== last; });
  const list = pool.length ? pool : enabled;
  return list[Math.floor(Math.random() * list.length)];
}

function cancelPetSequence() {
  petSeq.id++;
  petSeq.pending.forEach(function (entry) { entry.resolve(false); });
  petSeq.pending.clear();
  petSeq.timers.forEach(function (timer) { clearTimeout(timer); });
  petSeq.timers.clear();
  petWindows.forEach(function (win) {
    if (!win.isDestroyed()) win.webContents.send('pet:stop', {});
  });
}

function wait(ms, seqId) {
  return new Promise(function (resolve) {
    const timer = setTimeout(function () {
      petSeq.timers.delete(timer);
      resolve(seqId === petSeq.id);
    }, Math.max(0, ms));
    petSeq.timers.add(timer);
  });
}

function playOnPet(petId, clip) {
  return new Promise(function (resolve) {
    if (petSeq.id < 1) { resolve(false); return; }
    const win = petWindows.get(petId);
    if (!win || win.isDestroyed()) { resolve(false); return; }
    if (!data.settings.petEnabled) { resolve(false); return; }
    const pet = petById(petId);
    if (!pet || !pet.enabled) { resolve(false); return; }

    const playId = uid('play');
    const fallback = setTimeout(function () {
      if (petSeq.pending.has(playId)) {
        petSeq.pending.delete(playId);
        resolve(false);
      }
    }, Math.max(2500, (clip.duration || 4) * 1000 + 2600));

    petSeq.pending.set(playId, {
      resolve: function (ok) {
        clearTimeout(fallback);
        resolve(ok);
      }
    });

    lastClip[petId] = clip.id;
    win.webContents.send('pet:speak', {
      playId: playId,
      clip: {
        id: clip.id,
        label: clip.label,
        url: stateModule.refToUrl(clip.file),
        duration: clip.duration
      }
    });
  });
}

async function runSequence(steps) {
  const seqId = petSeq.id;

  for (let i = 0; i < steps.length; i++) {
    if (seqId !== petSeq.id) return;
    const step = steps[i];
    const pet = petById(step.petId);
    if (!pet || !pet.enabled || pet.paused || data.settings.petPaused) continue;
    if (!(await wait(step.delayMs, seqId))) return;
    const clip = pickClip(pet, step.mode, step.clipId);
    if (!clip) continue;
    await playOnPet(pet.id, clip);
  }
}

function triggerPet(petId) {
  if (!data.settings.petEnabled) return;
  const pet = petById(petId);
  if (!pet || !pet.enabled || pet.paused) return;
  cancelPetSequence();
  const seqId = petSeq.id;
  if (data.settings.petPaused) {
    const clip = pickClip(pet, 'random', null);
    if (clip) playOnPet(pet.id, clip);
    return seqId;
  }
  const scene = stateModule.selectReplyScene(data.replyScenes, petId);
  const steps = scene
    ? scene.steps
    : [{ petId: petId, mode: 'random', clipId: null, delayMs: 0 }];
  runSequence(steps).catch(function (err) {
    console.error('桌宠接话失败：', err);
  });
  return seqId;
}

function testPet(petId) {
  if (!data.settings.petEnabled) return;
  const pet = petById(petId);
  if (!pet) return;
  cancelPetSequence();
  const clip = pickClip(pet, 'random', null);
  if (clip) playOnPet(pet.id, clip);
}

/* ==================== 桌宠窗口拖动/缩放 ==================== */
let petDrag = null;
let petDragTimer = null;

function beginPetDrag(petId) {
  const win = petWindows.get(petId);
  if (!win || win.isDestroyed()) return;
  const start = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  petDrag = { petId: petId, win: win, start: start, bounds: bounds, moved: false, x: bounds.x, y: bounds.y };
  if (petDragTimer) clearInterval(petDragTimer);
  petDragTimer = setInterval(function () {
    if (!petDrag) return;
    const point = screen.getCursorScreenPoint();
    const dx = point.x - petDrag.start.x;
    const dy = point.y - petDrag.start.y;
    if (!petDrag.moved && Math.abs(dx) + Math.abs(dy) > 4) petDrag.moved = true;
    if (!petDrag.moved) return;
    petDrag.x = petDrag.bounds.x + dx;
    petDrag.y = petDrag.bounds.y + dy;
    petDrag.win.setPosition(Math.round(petDrag.x), Math.round(petDrag.y));
  }, 16);
}

function endPetDrag() {
  if (!petDrag) return { moved: false };
  const state = petDrag;
  petDrag = null;
  if (petDragTimer) {
    clearInterval(petDragTimer);
    petDragTimer = null;
  }
  if (state.moved) {
    const pet = petById(state.petId);
    if (pet) {
      pet.x = Math.round(state.x);
      pet.y = Math.round(state.y);
      stateModule.save(data);
      broadcastState();
    }
  }
  return { moved: state.moved };
}

function resizePet(petId, delta) {
  const pet = petById(petId);
  const win = petWindows.get(petId);
  if (!pet || !win || win.isDestroyed()) return;
  const next = Math.min(420, Math.max(120, Math.round(pet.size + delta)));
  if (next === pet.size) return;
  const old = win.getBounds();
  pet.size = next;
  const size = petWindowSize(pet);
  win.setBounds({
    x: Math.round(old.x + old.width - size.w),
    y: Math.round(old.y + old.height - size.h),
    width: size.w,
    height: size.h
  });
  win.webContents.send('pet:size', { size: next });
  stateModule.save(data);
  broadcastState();
}

/* ==================== 数据导入导出 ==================== */
async function exportData() {
  const win = BrowserWindow.getFocusedWindow() || windows.panel;
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const result = await dialog.showSaveDialog(win, {
    title: '导出备份',
    defaultPath: '全局工具箱-备份-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const payload = stateModule.exportState(data);
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, path: result.filePath };
}

async function importData() {
  const win = BrowserWindow.getFocusedWindow() || windows.panel;
  const result = await dialog.showOpenDialog(win, {
    title: '导入备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };

  try {
    const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    if (!raw || !Array.isArray(raw.items)) throw new Error('不是有效的备份文件');

    const apiKey = data.settings.ai.apiKey;
    const next = stateModule.normalize(raw);
    next.settings.ai.apiKey = apiKey;

    next.items = next.items.map(function (item) {
      if (item.image && /^data:image\//i.test(item.image)) {
        const rel = stateModule.saveImageDataUrl(item.image, 'media/items', uid('import'));
        if (rel) item.image = rel;
      }
      return item;
    });

    const clip = stateModule.normalize(raw).clipboard || [];
    next.clipboard = clip.map(function (entry) {
      if (entry.type === 'image' && entry.image && /^data:image\//i.test(entry.image)) {
        const rel = stateModule.saveImageDataUrl(entry.image, 'media/clipboard', uid('clip'));
        if (rel) entry.image = rel;
      }
      return entry;
    }).slice(0, 40);

    data = next;
    stateModule.save(data);
    syncPetWindows();
    applyPanelWindowSize();
    registerShortcuts();
    buildTray();
    broadcastState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function resetData() {
  const apiKey = data.settings.ai.apiKey;
  const fresh = stateModule.normalize(defaultState());
  fresh.settings.ai.apiKey = apiKey;
  data.clipboard.forEach(function (entry) { stateModule.deleteRef(entry.image); });
  data = fresh;
  stateModule.save(data);
  syncPetWindows();
  applyPanelWindowSize();
  registerShortcuts();
  buildTray();
  broadcastState();
  return { ok: true };
}

/* ==================== 托盘 ==================== */
function buildTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开面板', click: function () { showPanel({ remember: false, toggle: false }); } },
    { label: '功能菜单', click: function () { showView('launcher'); } },
    { label: 'AI 助手', click: function () { showView('aiHub'); } },
    { label: '剪贴板记录', click: function () { showView('clip'); } },
    { type: 'separator' },
    {
      label: '桌宠',
      submenu: [
        {
          label: '显示桌宠',
          type: 'checkbox',
          checked: !!data.settings.petEnabled,
          click: function (item) {
            data.settings.petEnabled = item.checked;
            stateModule.save(data);
            syncPetWindows();
            buildTray();
            broadcastState();
          }
        },
        {
          label: '暂停接话',
          type: 'checkbox',
          checked: !!data.settings.petPaused,
          click: function (item) {
            data.settings.petPaused = item.checked;
            if (item.checked) cancelPetSequence();
            stateModule.save(data);
            petWindows.forEach(function (win) {
              if (!win.isDestroyed()) win.webContents.send('pet:paused', { paused: !!data.settings.petPaused });
            });
            syncPetWindows();
            buildTray();
            broadcastState();
          }
        },
        { label: '桌宠设置', click: function () { showView('petSettings'); } }
      ]
    },
    { type: 'separator' },
    { label: '设置', click: function () { openSettings(''); } },
    { label: '退出', click: function () { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = path.join(SRC, 'assets', 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('全局工具箱');
  tray.on('click', function () { showPanel({ remember: false }); });
  tray.on('double-click', function () { showPanel({ remember: false, toggle: false }); });
  buildTray();
}

/* ==================== 设置副作用 ==================== */
let lastHotkeys = '';
let lastPanelSize = '';
let lastClipboardWatch = null;
let lastPetEnabled = null;

function applyStateSideEffects(previous) {
  const pin = !!data.settings.pin;
  if (windows.panel && !windows.panel.isDestroyed()) {
    windows.panel.setAlwaysOnTop(pin);
  }
  if (windows.clip && !windows.clip.isDestroyed()) {
    windows.clip.setAlwaysOnTop(!!data.settings.clipPin);
  }

  const panelSizeKey = data.settings.panelW + 'x' + data.settings.panelH;
  if (panelSizeKey !== lastPanelSize && windows.panel && !windows.panel.isDestroyed()) {
    lastPanelSize = panelSizeKey;
    applyPanelWindowSize();
  }

  const hotkeyKey = JSON.stringify(data.settings.hotkeys);
  if (hotkeyKey !== lastHotkeys) {
    lastHotkeys = hotkeyKey;
    registerShortcuts();
  }

  if (lastClipboardWatch !== data.settings.clipboardWatch) {
    lastClipboardWatch = data.settings.clipboardWatch;
    if (watcher) {
      if (data.settings.clipboardWatch) watcher.start();
      else watcher.stop();
    }
  }

  if (lastPetEnabled !== data.settings.petEnabled) {
    lastPetEnabled = data.settings.petEnabled;
    syncPetWindows();
  } else {
    syncPetWindows();
  }

  try { nativeTheme.themeSource = data.settings.theme === 'auto' ? 'system' : data.settings.theme; }
  catch (err) { /* ignore */ }

  if (previous && JSON.stringify(previous.settings.hotkeys) !== hotkeyKey) {
    const failed = Object.keys(shortcutErrors).map(function (key) {
      return key + '：' + shortcutErrors[key];
    });
    if (failed.length) notify('快捷键注册失败', failed.join('\n'));
  }
}

/* ==================== IPC ==================== */
function registerIpc() {
  ipcMain.handle('state:get', function () {
    return clientState();
  });

  ipcMain.on('state:get-sync', function (event) {
    event.returnValue = clientState();
  });

  ipcMain.handle('state:set', function (event, payload) {
    const before = data;
    const next = stateModule.normalize(payload);
    // 钉子只由 window:set-pin 修改，避免其它窗口或异步保存的旧快照意外解锁。
    const stalePin = next.settings.pin !== data.settings.pin;
    next.settings.pin = data.settings.pin;
    next.clipboard = data.clipboard;
    data = next;
    stateModule.save(data);
    applyStateSideEffects(before);
    buildTray();
    broadcastState(stalePin ? null : event.sender);
    return { ok: true, meta: { shortcutErrors: Object.assign({}, shortcutErrors) } };
  });

  ipcMain.handle('nav:open', function (event, name, payload) {
    if (name === 'panel' || name === 'main') showPanel({ remember: false, toggle: false });
    else if (name === 'aiDialog') {
      if (payload && payload.from === 'aiHub') hideView('aiHub');
      const context = payload && payload.context && payload.context.type === 'text'
        ? { type: 'text', text: String(payload.context.text || '').slice(0, 6000) }
        : { type: 'none' };
      const restoreView = payload && payload.from === 'aiHub' ? 'aiHub' : (currentView() || 'launcher');
      const win = openAI(context, restoreView) || windows.aiDialog;
      sendWhenReady(win, 'ai:context', Object.assign(clientAiContext(), { question: String(payload && payload.question || '').slice(0, 20000) }));
    }
    else if (name === 'pets' || name === 'petSettings') showView('petSettings');
    else showView(name);
    return { ok: true };
  });

  ipcMain.handle('nav:back', function (event, view) {
    if (view === 'launcher') showPanel({ remember: false, toggle: false });
    else if (view === 'panel') showPanel({ remember: false, toggle: false });
    else showView('launcher');
    return { ok: true };
  });

  ipcMain.handle('nav:open-settings', function (event, section) {
    const current = currentView();
    if (current === 'aiDialog') closeAiDialog(false);
    openSettings(section || '');
    return { ok: true };
  });

  ipcMain.handle('nav:close-ai', function () {
    closeAiDialog(true);
    return { ok: true };
  });

  ipcMain.handle('window:hide', function (event, payload) {
    const senderView = Object.keys(windows).find(function (name) {
      const win = windows[name];
      return win && !win.isDestroyed() && win.webContents === event.sender;
    }) || '';
    const view = (payload && payload.view) || senderView || currentView();
    if (view === 'panel') hidePanel();
    else if (view === 'aiDialog') closeAiDialog(false);
    else hideView(view);
    if (view === 'panel' && payload && payload.showTip) {
      notify('已收进托盘', '程序仍在后台运行，按快捷键随时呼出。');
    }
    return { ok: true };
  });

  ipcMain.handle('window:quit', function () {
    quitting = true;
    app.quit();
    return { ok: true };
  });

  /* 窗口拖动：渲染层按住标题栏或透明外边距时，用屏幕坐标换算窗口位置 */
  let windowDrag = null;
  const windowInteractionModes = new WeakMap();
  ipcMain.on('window:drag-start', function (event, payload) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const mode = windowInteractionModes.get(event.sender);
    if (mode && mode !== 'move') return;
    windowInteractionModes.set(event.sender, 'move');
    const bounds = win.getBounds();
    windowDrag = {
      win: win,
      dx: Math.round(Number(payload && payload.x) || 0) - bounds.x,
      dy: Math.round(Number(payload && payload.y) || 0) - bounds.y,
      width: bounds.width,
      height: bounds.height
    };
  });
  ipcMain.on('window:drag-move', function (event, payload) {
    if (windowInteractionModes.get(event.sender) !== 'move') return;
    if (!windowDrag || windowDrag.win.isDestroyed()) return;
    if (event.sender !== windowDrag.win.webContents) return;
    windowDrag.win.setBounds({
      x: Math.round(Number(payload && payload.x) || 0) - windowDrag.dx,
      y: Math.round(Number(payload && payload.y) || 0) - windowDrag.dy,
      width: windowDrag.width,
      height: windowDrag.height
    });
  });
  ipcMain.on('window:drag-end', function (event) {
    if (windowDrag && event.sender === windowDrag.win.webContents) windowDrag = null;
    if (windowInteractionModes.get(event.sender) === 'move') windowInteractionModes.delete(event.sender);
  });

  ipcMain.handle('window:set-pin', function (event, pin) {
    data.settings.pin = !!pin;
    stateModule.save(data);
    if (windows.panel && !windows.panel.isDestroyed()) windows.panel.setAlwaysOnTop(!!pin);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('window:set-clip-pin', function (event, pin) {
    data.settings.clipPin = !!pin;
    stateModule.save(data);
    if (windows.clip && !windows.clip.isDestroyed()) windows.clip.setAlwaysOnTop(!!pin);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('window:resize-panel', function (event, size) {
    const mode = windowInteractionModes.get(event.sender);
    if (mode && mode !== 'resize') return { ok: false, error: 'window-move-active' };
    windowInteractionModes.set(event.sender, 'resize');
    const w = Math.min(1120, Math.max(480, Math.round(Number(size && size.w) || 700)));
    const h = Math.min(920, Math.max(420, Math.round(Number(size && size.h) || 590)));
    data.settings.panelW = w;
    data.settings.panelH = h;
    data.settings.panelSize = 'custom';
    lastPanelSize = w + 'x' + h;
    stateModule.save(data);
    const win = windows.panel;
    if (win && !win.isDestroyed()) {
      /* IPC 保存的是面板尺寸；窗口另加 60px 透明边距，左/上缩放也要提交最终位置。 */
      const bounds = win.getBounds();
      const x = size && Number.isFinite(size.x) ? Math.round(size.x) : bounds.x;
      const y = size && Number.isFinite(size.y) ? Math.round(size.y) : bounds.y;
      win.setBounds({ x: x, y: y, width: w + 60, height: h + 60 });
    }
    windowInteractionModes.delete(event.sender);
    broadcastState();
    return { ok: true, w: w, h: h };
  });

  /* 拖动过程中实时改窗口大小，不写盘不广播 */
  ipcMain.on('window:resize-panel-live', function (event, size) {
    const win = windows.panel;
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    const mode = windowInteractionModes.get(event.sender);
    if (mode && mode !== 'resize') return;
    windowInteractionModes.set(event.sender, 'resize');
    const w = Math.min(1180, Math.max(480, Math.round(Number(size && size.w) || 700)));
    const h = Math.min(980, Math.max(420, Math.round(Number(size && size.h) || 590)));
    const bounds = win.getBounds();
    /* 只有右下角拖动时位置不动；拖左/上边时渲染端会带上新的 x/y */
    const x = Number.isFinite(Number(size && size.x)) ? Math.round(Number(size.x)) : bounds.x;
    const y = Number.isFinite(Number(size && size.y)) ? Math.round(Number(size.y)) : bounds.y;
    if (bounds.x === x && bounds.y === y && bounds.width === w && bounds.height === h) return;
    win.setBounds({ x: x, y: y, width: w, height: h });
  });

  ipcMain.handle('window:resize-view', function (event, size) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false };
    const mode = windowInteractionModes.get(event.sender);
    if (mode && mode !== 'resize') return { ok: false, error: 'window-move-active' };
    windowInteractionModes.set(event.sender, 'resize');
    const bounds = win.getBounds();
    const width = Math.min(1600, Math.max(360, Math.round(Number(size && size.w) || bounds.width)));
    const height = Math.min(1200, Math.max(300, Math.round(Number(size && size.h) || bounds.height)));
    const x = size && Number.isFinite(size.x) ? Math.round(size.x) : bounds.x;
    const y = size && Number.isFinite(size.y) ? Math.round(size.y) : bounds.y;
    win.setBounds({ x: x, y: y, width: width, height: height });
    windowInteractionModes.delete(event.sender);
    return { ok: true, w: width, h: height };
  });

  ipcMain.on('window:resize-view-live', function (event, size) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const mode = windowInteractionModes.get(event.sender);
    if (mode && mode !== 'resize') return;
    windowInteractionModes.set(event.sender, 'resize');
    const bounds = win.getBounds();
    const width = Math.min(1600, Math.max(360, Math.round(Number(size && size.w) || bounds.width)));
    const height = Math.min(1200, Math.max(300, Math.round(Number(size && size.h) || bounds.height)));
    const x = size && Number.isFinite(size.x) ? Math.round(size.x) : bounds.x;
    const y = size && Number.isFinite(size.y) ? Math.round(size.y) : bounds.y;
    win.setBounds({ x: x, y: y, width: width, height: height });
  });

  ipcMain.handle('window:set-panel-size', function (event, payload) {
    const sizes = { compact: [560, 500], standard: [700, 590], large: [840, 680] };
    const value = payload && payload.value;
    const pair = sizes[value];
    if (!pair) return { ok: false };
    data.settings.panelSize = value;
    data.settings.panelW = pair[0];
    data.settings.panelH = pair[1];
    stateModule.save(data);
    applyPanelWindowSize();
    broadcastState();
    return { ok: true, w: pair[0], h: pair[1] };
  });

  ipcMain.handle('snippet:activate', async function (event, id) {
    const item = data.items.find(function (entry) { return entry.id === id; });
    if (!item) return { ok: false };
    let ok = false;
    if (item.type === 'image') ok = await writeImageToClipboard(item.image);
    else ok = await writeTextToClipboard(item.content);
    if (!ok) return { ok: false, error: item.type === 'image' ? '这张图片暂时无法写入剪贴板' : '写入剪贴板失败' };
    const panelWin = windows.panel;
    /* 以窗口真实的置顶状态为准，避免设置里 pin 被其它窗口的旧状态覆盖后误收起 */
    const pinned = !!data.settings.pin || !!(panelWin && !panelWin.isDestroyed() && panelWin.isAlwaysOnTop());
    if (pinned) {
      /* 置顶常驻：只让出焦点，不隐藏窗口 */
      data.settings.pin = true;
      if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) {
        try { panelWin.blur(); } catch (err) { /* ignore */ }
      }
    } else {
      hidePanel();
    }
    pasteIntoPrevious();
    return { ok: true };
  });

  ipcMain.handle('snippet:copy', async function (event, id) {
    const item = data.items.find(function (entry) { return entry.id === id; });
    if (!item) return { ok: false };
    if (item.type === 'image') {
      const ok = await writeImageToClipboard(item.image);
      return { ok: ok, error: ok ? '' : '图片无法写入剪贴板' };
    }
    const ok = await writeTextToClipboard(item.content);
    return { ok: ok };
  });

  ipcMain.handle('media:save-image', function (event, payload) {
    const id = (payload && payload.id) || uid('item');
    const rel = stateModule.saveImageDataUrl(payload && payload.dataUrl, 'media/items', id);
    if (!rel) return { ok: false };
    return { ok: true, ref: rel, url: stateModule.refToUrl(rel) };
  });

  ipcMain.handle('clipboard:copy', async function (event, id) {
    const entry = data.clipboard.find(function (item) { return item.id === id; });
    if (!entry) return { ok: false };
    if (entry.type === 'image') {
      const ok = await writeImageToClipboard(entry.image);
      return { ok: ok, error: ok ? '' : '图片无法写入剪贴板' };
    }
    const ok = await writeTextToClipboard(entry.content);
    return { ok: ok };
  });

  ipcMain.handle('clipboard:paste', async function (event, id) {
    const entry = data.clipboard.find(function (item) { return item.id === id; });
    if (!entry) return { ok: false };
    const ok = entry.type === 'image'
      ? await writeImageToClipboard(entry.image)
      : await writeTextToClipboard(entry.content);
    if (!ok) return { ok: false };
    /* 置顶状态下保持窗口可见，方便连续粘贴多条 */
    if (data.settings.clipPin) {
      pasteIntoPrevious();
      return { ok: true, kept: true };
    }
    const clipWin = windows.clip;
    if (clipWin && !clipWin.isDestroyed() && clipWin.isVisible()) {
      try { clipWin.blur(); } catch (e) { /* ignore */ }
    }
    hideView('clip');
    pasteIntoPrevious();
    return { ok: true };
  });

  ipcMain.handle('clipboard:read-now', async function () {
    const payload = await watcher.readNow();
    if (!payload) return { ok: false, error: '剪贴板里没有可读取的内容' };
    addClipEntry(payload, '手动');
    return { ok: true };
  });

  ipcMain.handle('clipboard:clear', function () {
    data.clipboard.forEach(function (entry) { stateModule.deleteRef(entry.image); });
    data.clipboard = [];
    stateModule.save(data);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('clipboard:remove', function (event, id) {
    const entry = data.clipboard.find(function (item) { return item.id === id; });
    if (entry) stateModule.deleteRef(entry.image);
    data.clipboard = data.clipboard.filter(function (item) { return item.id !== id; });
    stateModule.save(data);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('clipboard:write-text', async function (event, text) {
    const ok = await writeTextToClipboard(text);
    return { ok: ok };
  });

  ipcMain.handle('capture:selection', async function () {
    watcher.suspend(2500);
    const text = await captureSelection();
    openAI({ type: text ? 'text' : 'none', text: text || '' }, currentView() || 'aiHub');
    return { ok: true, text: text };
  });

  ipcMain.handle('capture:shot', function () {
    startScreenshot();
    return { ok: true };
  });

  ipcMain.handle('ai:send', async function (event, payload) {
    const requestId = payload.requestId || uid('req');
    const editorMode = payload.mode === 'editor';
    const persona = editorMode ? null
      : data.personas.find(function (item) { return item.id === payload.personaId; })
        || data.personas.find(function (item) { return item.id === data.settings.personaId; })
        || null;
    const prompt = editorMode ? null
      : data.prompts.find(function (item) { return item.id === payload.promptId; })
        || data.prompts.find(function (item) { return item.id === data.settings.promptId; })
        || null;

    const config = data.settings.ai;
    const win = windows.aiDialog;
    if (!win || win.isDestroyed()) return { ok: false };

    if (!String(config.baseUrl || '').trim()) {
      win.webContents.send('ai:error', { requestId: requestId, message: '先在设置里填 Base URL' });
      return { ok: false };
    }
    if (!String(config.model || '').trim()) {
      win.webContents.send('ai:error', { requestId: requestId, message: '先在设置里填模型名称' });
      return { ok: false };
    }

    const controller = new AbortController();
    aiRequests.set(requestId, controller);

    try {
      await ai.streamChat({
        config: config,
        mode: editorMode ? 'editor' : 'legacy',
        persona: persona,
        prompt: prompt,
        userContext: payload.userContext != null ? payload.userContext : (config.userContext || ''),
        context: payload.contextMode === 'none' ? { type: 'none' } : aiContext,
        question: payload.question || '',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
        onDelta: function (text) {
          if (!win.isDestroyed()) win.webContents.send('ai:delta', { requestId: requestId, text: text });
        },
        onDone: function () {
          aiRequests.delete(requestId);
          if (!win.isDestroyed()) win.webContents.send('ai:done', { requestId: requestId });
        }
      });
    } catch (err) {
      aiRequests.delete(requestId);
      const aborted = err && (err.name === 'AbortError' || (controller.signal && controller.signal.aborted));
      if (!win.isDestroyed()) {
        if (aborted) win.webContents.send('ai:done', { requestId: requestId, aborted: true });
        else win.webContents.send('ai:error', { requestId: requestId, message: err.message || '请求失败' });
      }
    }
    return { ok: true, requestId: requestId };
  });

  ipcMain.handle('ai:abort', function (event, requestId) {
    const controller = aiRequests.get(requestId);
    if (controller) {
      try { controller.abort(); } catch (e) { /* ignore */ }
      aiRequests.delete(requestId);
    }
    return { ok: true };
  });

  ipcMain.handle('ai:test', async function (event, config) {
    try {
      const result = await ai.testConnection(config || data.settings.ai);
      return { ok: true, result: result };
    } catch (err) {
      return { ok: false, error: err.message || '连接失败' };
    }
  });

  ipcMain.handle('ai:models', async function (event, config) {
    try { return { ok: true, models: await ai.listModels(config || data.settings.ai) }; }
    catch (err) { return { ok: false, error: err.message || '无法读取模型列表' }; }
  });

  ipcMain.handle('data:export', function () { return exportData(); });
  ipcMain.handle('data:import', function () { return importData(); });
  ipcMain.handle('data:reset', function () { return resetData(); });

  ipcMain.handle('pet:pick-assets', async function (event, kind) {
    const win = BrowserWindow.getFocusedWindow() || windows.petSettings;
    if (kind === 'avatar') {
      const result = await dialog.showOpenDialog(win, {
        title: '选择桌宠头像',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      });
    const file = result.filePaths && result.filePaths[0];
    return { ok: !result.canceled, path: file, url: file ? pathToFileURL(file).href : '' };
    }
    const result = await dialog.showOpenDialog(win, {
      title: '选择桌宠原声（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'webm'] }]
    });
    return { ok: !result.canceled, paths: result.filePaths || [], urls: (result.filePaths || []).map(file => pathToFileURL(file).href) };
  });

  ipcMain.handle('pet:create', async function (event, payload) {
    try {
      const name = String((payload && payload.name) || '').trim();
      const avatarPath = payload && payload.avatarPath;
      const audioPaths = (payload && payload.audioPaths) || [];
      const labels = (payload && Array.isArray(payload.labels)) ? payload.labels : [];
      if (!name) throw new Error('先给桌宠起个名字');
      if (!avatarPath || !fs.existsSync(avatarPath)) throw new Error('头像文件不存在');
      if (!audioPaths.length) throw new Error('至少选一段原声音频');
      if (audioPaths.length > 200) throw new Error('一次最多添加 200 段录音');
      const allowedAudio = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.webm']);
      audioPaths.forEach(function (file) {
        if (!allowedAudio.has(path.extname(file).toLowerCase())) throw new Error('请选择支持的音频格式');
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('每段录音不得超过 50MB');
      });
      const image = nativeImage.createFromPath(avatarPath);
      if (image.isEmpty()) throw new Error('无法读取形象图，请选择 PNG、JPG 或 WEBP 图片');
      const dimensions = image.getSize();
      const ratio = Math.min(1, 1024 / Math.max(dimensions.width, dimensions.height));
      const avatar = ratio < 1 ? image.resize({ width: Math.max(1, Math.round(dimensions.width * ratio)), height: Math.max(1, Math.round(dimensions.height * ratio)), quality: 'best' }) : image;

      const id = 'diy-' + uid('pet');
      const petDir = path.join(stateModule.mediaDir, 'pets', id);
      const clipDir = path.join(petDir, 'clips');
      fs.mkdirSync(clipDir, { recursive: true });

      const avatarExt = '.png';
      fs.writeFileSync(path.join(petDir, 'avatar.png'), avatar.toPNG());

      const clips = audioPaths.map(function (file, index) {
        const ext = path.extname(file).toLowerCase() || '.wav';
        const filename = String(index + 1).padStart(2, '0') + ext;
        fs.copyFileSync(file, path.join(clipDir, filename));
        return {
          id: index + 1,
          label: String(labels[index] || '').trim() || path.basename(file, path.extname(file)),
          file: 'media/pets/' + id + '/clips/' + filename,
          duration: Math.min(3600, Math.max(0, Number((payload.durations || [])[index]) || 0)),
          enabled: true
        };
      });

      const pet = {
        id: id,
        name: name,
        tag: 'DIY',
        builtin: false,
        avatar: 'media/pets/' + id + '/avatar' + avatarExt,
        clips: clips,
        enabled: true,
        paused: false,
        size: 196,
        x: null,
        y: null,
        order: data.pets.length
      };

      data.pets.push(pet);
      data.settings.petEnabled = true;
      stateModule.save(data);
      syncPetWindows();
      broadcastState();
      return { ok: true, pet: clientPet(pet) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('pet:delete', async function (event, id) {
    const pet = petById(id);
    if (!pet) return { ok: false };
    if (pet.builtin) return { ok: false, error: '内置桌宠可以停用，不能删除' };
    const petsRoot = path.resolve(stateModule.mediaDir, 'pets');
    const ownedDir = path.resolve(petsRoot, String(id));
    if (!/^[A-Za-z0-9_-]+$/.test(String(id)) || !ownedDir.startsWith(petsRoot + path.sep)) {
      return { ok: false, error: '桌宠素材路径无效' };
    }
    destroyPetWindow(id);
    data.pets = data.pets.filter(function (item) { return item.id !== id; });
    data.replyScenes.forEach(function (scene) {
      scene.steps = scene.steps.filter(function (step) { return step.petId !== id; });
    });
    data.replyScenes = data.replyScenes.filter(function (scene) { return !!scene.steps.length; });
    if (!pet.builtin) {
      try { fs.rmSync(ownedDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
    stateModule.save(data);
    syncPetWindows();
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('pet:update', function (event, payload) {
    const pet = petById(payload && payload.id);
    if (!pet) return { ok: false };
    if (payload.patch && typeof payload.patch === 'object') {
      ['name', 'tag', 'enabled', 'paused', 'size', 'avatar'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(payload.patch, key)) pet[key] = payload.patch[key];
      });
      if (Array.isArray(payload.patch.clips)) {
        pet.clips = pet.clips.map(function (clip) {
          const next = payload.patch.clips.find(function (item) { return item.id === clip.id; });
          return next ? Object.assign({}, clip, { enabled: next.enabled !== false }) : clip;
        });
      }
    }
    if (payload.patch && payload.patch.enabled === true) {
      data.settings.petEnabled = true;
    } else if (payload.patch && payload.patch.enabled === false &&
      !data.pets.some(function (item) { return item.enabled; })) {
      data.settings.petEnabled = false;
    }
    lastPetEnabled = data.settings.petEnabled;
    stateModule.save(data);
    syncPetWindows();
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('pet:test', function (event, id) {
    testPet(id);
    return { ok: true };
  });

  ipcMain.handle('pet:click', function (event, id) {
    beginPetDrag(id);
    return { ok: true };
  });

  ipcMain.handle('pet:pointer-up', function (event, id) {
    const result = endPetDrag();
    if (!result.moved) triggerPet(id);
    return result;
  });

  ipcMain.handle('pet:resize', function (event, payload) {
    resizePet(payload && payload.id, Number(payload && payload.delta) || 0);
    return { ok: true };
  });

  ipcMain.on('pet:played', function (event, payload) {
    const pending = petSeq.pending.get(payload && payload.playId);
    if (pending) {
      petSeq.pending.delete(payload.playId);
      pending.resolve(!!payload.ok);
    }
  });

  ipcMain.on('shot:confirm', function (event, payload) {
    confirmShot(payload || {});
  });

  ipcMain.on('shot:cancel', function () {
    cancelShot();
  });

  ipcMain.handle('app:info', function () {
    return {
      version: app.getVersion(),
      platform: process.platform,
      userData: app.getPath('userData'),
      helper: helper.hasHelper(),
      shortcutErrors: Object.assign({}, shortcutErrors)
    };
  });
}

/* ==================== 应用启动 ==================== */
app.whenReady().then(function () {
  app.setAppUserModelId('com.toolbox.global');
  Menu.setApplicationMenu(null);

  stateModule.init(app.getPath('userData'));
  data = stateModule.load();

  /* 先同步系统级深浅色偏好，再创建任何窗口，避免滚动条与桌宠气泡按旧主题渲染 */
  try { nativeTheme.themeSource = data.settings.theme === 'auto' ? 'system' : data.settings.theme; }
  catch (err) { /* ignore */ }

  lastHotkeys = JSON.stringify(data.settings.hotkeys);
  lastPanelSize = data.settings.panelW + 'x' + data.settings.panelH;
  lastClipboardWatch = data.settings.clipboardWatch;
  lastPetEnabled = data.settings.petEnabled;

  watcher = new ClipboardWatcher({
    getState: function () { return data; },
    onEntry: function (payload) { addClipEntry(payload, '监听'); }
  });
  if (data.settings.clipboardWatch) watcher.start();

  registerIpc();
  createTray();
  registerShortcuts();

  fgWatch = helper.watchForeground(function (hwnd, className) {
    if (isOurHandle(hwnd) || isShellForeground(hwnd, className)) return;
    externalForeground = hwnd;
  });

  syncPetWindows();

  /* 桌宠要保持压在其它窗口上面，定期重新声明一次置顶 */
  setInterval(function () {
    petWindows.forEach(function (win) {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      if (typeof win.moveTop === 'function') win.moveTop();
    });
  }, 5000);

  if (captureView) {
    runCapture(captureView);
    return;
  }

  warnShortcutErrors();
  showView('launcher');
});

app.on('window-all-closed', function () {
  // 常驻托盘，不退出
});

app.on('before-quit', function () {
  quitting = true;
  try { stateModule.flush(data); } catch (e) { /* ignore */ }
  if (watcher) watcher.stop();
  if (fgWatch) fgWatch.stop();
  globalShortcut.unregisterAll();
});

app.on('will-quit', function () {
  globalShortcut.unregisterAll();
});

function warnShortcutErrors() {
  const failed = Object.keys(shortcutErrors);
  if (failed.length) {
    notify('部分快捷键没有注册成功', failed.map(function (key) {
      return key + '：' + shortcutErrors[key];
    }).join('\n'));
  }
}

async function runCapture(view) {
  await new Promise(function (resolve) { setTimeout(resolve, 600); });
  if (view === 'aiDialog') {
    openAI({ type: 'text', text: '明天上午十点前把方案发我，重点说明预算和排期。' }, 'panel');
  } else if (view === 'panel') {
    showPanel({ remember: false, toggle: false });
  } else if (view === 'pet') {
    const pet = data.pets[0];
    if (pet) {
      createPetWindow(pet);
      setTimeout(function () { triggerPet(pet.id); }, 900);
    }
  } else {
    showView(view);
  }

  await new Promise(function (resolve) { setTimeout(resolve, 1400); });

  let win = windows[view] || null;
  if (view === 'pet') win = petWindows.get(data.pets[0] && data.pets[0].id) || null;
  if (win && !win.isDestroyed()) {
    try {
      const image = await win.webContents.capturePage();
      const dir = path.join(ROOT, '.screenshots');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'electron-' + view + '.png'), image.toPNG());
      console.log('已截图：.screenshots/electron-' + view + '.png');
    } catch (err) {
      console.error('截图失败：', err.message);
    }
  }
  quitting = true;
  app.quit();
}
