'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const mainFile = path.join(root, 'electron', 'main.js');
const productionRequire = createRequire(mainFile);
const stateModule = productionRequire('./state');
const { defaultState } = productionRequire('./seed');

let allWindows = [];
let handlers = new Map();
let saves = [];
let display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
};

class FakeWebContents {
  constructor(owner) {
    this.owner = owner;
    this.loading = false;
    this.sent = [];
    this.listeners = new Map();
  }

  isLoading() {
    return this.loading;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  on(event, callback) {
    const list = this.listeners.get(event) || [];
    list.push(callback);
    this.listeners.set(event, list);
  }

  once(event, callback) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      callback(...args);
    };
    this.on(event, wrapped);
  }

  removeListener(event, callback) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(event, list.filter(item => item !== callback));
  }

  emit(event, ...args) {
    const list = Array.from(this.listeners.get(event) || []);
    list.forEach(callback => callback(...args));
  }

  setWindowOpenHandler() {}
}

class FakeBrowserWindow {
  constructor(options) {
    const opts = options || {};
    this.options = opts;
    this.webContents = new FakeWebContents(this);
    this.bounds = {
      x: Number(opts.x) || 0,
      y: Number(opts.y) || 0,
      width: Number(opts.width) || 0,
      height: Number(opts.height) || 0
    };
    this.destroyed = false;
    this.visible = false;
    this.shown = 0;
    this.listeners = new Map();
    this.url = '';
    allWindows.push(this);
  }

  static getAllWindows() {
    return allWindows.filter(win => !win.isDestroyed());
  }

  static getFocusedWindow() {
    return FakeBrowserWindow.getAllWindows().find(win => win.visible) || null;
  }

  static resetForTest() {
    allWindows = [];
  }

  on(event, callback) {
    const list = this.listeners.get(event) || [];
    list.push(callback);
    this.listeners.set(event, list);
  }

  once(event, callback) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      callback(...args);
    };
    this.on(event, wrapped);
  }

  removeListener(event, callback) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(event, list.filter(item => item !== callback));
  }

  emit(event, ...args) {
    const list = Array.from(this.listeners.get(event) || []);
    list.forEach(callback => callback(...args));
  }

  loadFile(file, query) {
    this.url = file;
    this.query = query;
    this.webContents.loading = true;
    return Promise.resolve();
  }

  finishLoad(options) {
    const opts = options || {};
    this.webContents.loading = false;
    this.webContents.emit('did-finish-load');
    if (opts.readyToShow !== false) this.emit('ready-to-show');
  }

  setMenu() {}
  setAlwaysOnTop() {}
  moveTop() {}

  showInactive() {
    this.visible = true;
    this.shown++;
  }

  show() {
    this.visible = true;
    this.shown++;
  }

  hide() {
    this.visible = false;
  }

  focus() {}

  isVisible() {
    return this.visible;
  }

  isMinimized() {
    return false;
  }

  isDestroyed() {
    return this.destroyed;
  }

  getBounds() {
    return Object.assign({}, this.bounds);
  }

  setBounds(bounds) {
    this.bounds = Object.assign({}, bounds);
  }

  setPosition(x, y) {
    this.bounds.x = x;
    this.bounds.y = y;
  }

  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.emit('closed');
  }

  capturePage() {
    return Promise.resolve({ toPNG: () => Buffer.alloc(0) });
  }
}

const ipcMain = {
  handle(channel, callback) {
    handlers.set(channel, callback);
  },
  on(channel, callback) {
    handlers.set(channel, callback);
  },
  removeHandler(channel) {
    handlers.delete(channel);
  }
};

const electron = {
  app: {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    on: () => {},
    quit: () => {}
  },
  BrowserWindow: FakeBrowserWindow,
  ipcMain,
  screen: {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => display,
    getAllDisplays: () => [display]
  },
  globalShortcut: {
    register: () => true,
    unregisterAll: () => {}
  },
  Tray: function Tray() {},
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createEmpty: () => ({})
  },
  clipboard: {},
  ClipboardItem: function ClipboardItem() {},
  dialog: {},
  desktopCapturer: {},
  Notification: function Notification() {},
  nativeTheme: { themeSource: 'light' },
  shell: {}
};

const helperStub = new Proxy({}, {
  get: () => async () => null
});
const aiStub = new Proxy({}, {
  get: () => async () => ''
});

const mainSource = fs.readFileSync(mainFile, 'utf8').split('app.whenReady().then(function () {')[0];
const internals = vm.runInThisContext('(function(require, __dirname) {\n' + mainSource + `
  return {
    prepare: function (saved) {
      Array.from(petWindows.keys()).forEach(destroyPetWindow);
      BrowserWindow.resetForTest();
      data = stateModule.normalize(saved);
      lastHotkeys = JSON.stringify(data.settings.hotkeys);
      lastPanelSize = data.settings.panelW + 'x' + data.settings.panelH;
      lastClipboardWatch = data.settings.clipboardWatch;
      lastPetEnabled = data.settings.petEnabled;
    },
    register: registerIpc,
    syncPetWindows: syncPetWindows,
    getState: function () { return data; },
    getPetWindows: function () { return petWindows; }
  };
})`, { filename: mainFile })(function (id) {
  if (id === 'electron') return electron;
  if (id === './state') {
    return Object.assign({}, stateModule, {
      save: function (snapshot) {
        saves.push(JSON.parse(JSON.stringify(snapshot)));
      }
    });
  }
  if (id === './helper') return helperStub;
  if (id === './ai') return aiStub;
  return productionRequire(id);
}, path.dirname(mainFile));

internals.register();

function petState(master, enabled, positions) {
  const saved = defaultState();
  saved.settings.petEnabled = master;
  saved.settings.clipboardWatch = false;
  saved.pets = saved.pets.map((pet, index) => Object.assign({}, pet, {
    enabled: enabled[index],
    x: positions && positions[index] ? positions[index].x : null,
    y: positions && positions[index] ? positions[index].y : null
  }));
  return saved;
}

function reset(saved) {
  saves = [];
  display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }
  };
  internals.prepare(saved);
}

async function invoke(channel, payload) {
  const handler = handlers.get(channel);
  assert.equal(typeof handler, 'function', 'missing IPC handler: ' + channel);
  return handler({ sender: {} }, payload);
}

test('startup repairs a master-on state with every pet disabled', async () => {
  reset(petState(true, [false, false, false]));
  internals.syncPetWindows();
  const current = internals.getState();
  assert.equal(current.pets[0].enabled, true);
  assert.equal(internals.getPetWindows().size, 1);
  assert.ok(saves.length >= 1);
});

test('enabling one pet opens the master switch and its window', async () => {
  reset(petState(false, [false, false, false]));
  await invoke('pet:update', { id: 'sun', patch: { enabled: true } });
  const current = internals.getState();
  assert.equal(current.settings.petEnabled, true);
  assert.equal(current.pets[0].enabled, true);
  assert.equal(internals.getPetWindows().has('sun'), true);
});

test('disabling the last enabled pet closes the master switch', async () => {
  reset(petState(true, [true, false, false]));
  internals.syncPetWindows();
  await invoke('pet:update', { id: 'sun', patch: { enabled: false } });
  const current = internals.getState();
  assert.equal(current.settings.petEnabled, false);
  assert.equal(internals.getPetWindows().size, 0);
});

test('opening the master preserves a partial pet selection', async () => {
  reset(petState(false, [true, false, true]));
  const saved = JSON.parse(JSON.stringify(internals.getState()));
  saved.settings.petEnabled = true;
  await invoke('state:set', saved);
  const current = internals.getState();
  assert.deepEqual(current.pets.map(pet => pet.enabled), [true, false, true]);
  assert.deepEqual(Array.from(internals.getPetWindows().keys()).sort(), ['shaolan', 'sun']);
});

test('opening the master repairs an all-disabled selection', async () => {
  reset(petState(false, [false, false, false]));
  const saved = JSON.parse(JSON.stringify(internals.getState()));
  saved.settings.petEnabled = true;
  await invoke('state:set', saved);
  const current = internals.getState();
  assert.equal(current.pets[0].enabled, true);
  assert.equal(internals.getPetWindows().size, 1);
});

test('a saved off-screen pet is moved fully into the work area', async () => {
  reset(petState(true, [true, false, false], [{ x: -5000, y: 5000 }]));
  internals.syncPetWindows();
  const win = Array.from(internals.getPetWindows().values())[0];
  const bounds = win.getBounds();
  assert.ok(bounds.x >= display.workArea.x);
  assert.ok(bounds.y >= display.workArea.y);
  assert.ok(bounds.x + bounds.width <= display.workArea.x + display.workArea.width);
  assert.ok(bounds.y + bounds.height <= display.workArea.y + display.workArea.height);
});

test('pet init waits for the renderer and a finished load also reveals the window', async () => {
  reset(petState(true, [true, false, false]));
  internals.syncPetWindows();
  const win = Array.from(internals.getPetWindows().values())[0];
  assert.equal(win.webContents.sent.filter(item => item.channel === 'pet:init').length, 0);
  win.finishLoad({ readyToShow: false });
  assert.equal(win.webContents.sent.filter(item => item.channel === 'pet:init').length, 1);
  assert.equal(win.shown, 1);
});
