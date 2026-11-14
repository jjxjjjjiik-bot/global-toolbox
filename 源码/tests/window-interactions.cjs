'use strict';

// Run with Node; reuse the installed Electron to exercise real DOM events and IPC.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-window-tests-'));
  console.log('Temporary Electron profile: ' + profile);
  try {
    const result = spawnSync(require('electron'), [__filename, '--test-profile=' + profile, ...process.argv.slice(2)], {
      stdio: 'inherit', windowsHide: true, timeout: 90000
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
  } finally {
    // Only remove the exact temporary directory created by this test run.
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('toolbox-window-tests-'));
    fs.rmSync(profile, { recursive: true, force: true });
    console.log('Removed temporary Electron profile: ' + profile);
  }
} else {
  const electron = require('electron');
  const { app, BrowserWindow } = electron;
  const { createRequire } = require('node:module');
  const vm = require('node:vm');
  const root = path.resolve(__dirname, '..');
  app.setPath('userData', process.argv.find(arg => arg.startsWith('--test-profile=')).slice(15));
  app.disableHardwareAcceleration();

  app.whenReady().then(async function () {
    // Load production handlers without starting trays, shortcuts, pets or clipboard watching.
    // Keep the real preload, renderer, BrowserWindow, state normalization and IPC.
    const mainFile = path.join(root, 'electron', 'main.js');
    const productionRequire = createRequire(mainFile);
    const stateModule = productionRequire('./state');
    let clipboardText = '';
    let clipboardFails = false;
    let aiCalls = [];
    let aiBehavior = 'success';
    let aiErrorDelay = 0;
    const aiModule = productionRequire('./ai');
    const aiMock = Object.assign({}, aiModule, {
      streamChat: async function (options) {
        aiCalls.push(options);
        if (aiBehavior === 'error') {
          if (aiErrorDelay) await new Promise(resolve => setTimeout(resolve, aiErrorDelay));
          throw new Error('mock stream failure');
        }
        if (options.onDelta) options.onDelta('mock answer');
        if (options.onDone) options.onDone();
        return 'mock answer';
      }
    });
    const mainSource = fs.readFileSync(mainFile, 'utf8').split('app.whenReady().then(function () {')[0];
    const load = vm.runInThisContext('(function(require, __dirname) {\n' + mainSource + `
      return {
        setup: function (win, clipboardEntries, view) {
          data = stateModule.normalize(defaultState());
          data.items = [{ id: 'test-snippet', type: 'text', title: 'Test snippet', content: 'A real test phrase', groupId: data.groups[0].id, useCount: 0, createdAt: 1, lastUsedAt: 0 }];
          data.settings.petEnabled = false;
          data.settings.clipboardWatch = false;
          data.settings.panelSize = 'custom';
          data.settings.panelW = 600;
          data.settings.panelH = 460;
          data.settings.ai.baseUrl = 'http://mock.local/v1';
          data.settings.ai.apiKey = 'test-key';
          data.settings.ai.model = 'mock-model';
          data.settings.ai.connection = null;
          data.clipboard = clipboardEntries || [];
          lastHotkeys = JSON.stringify(data.settings.hotkeys);
          lastPanelSize = '600x460';
          lastClipboardWatch = false;
          lastPetEnabled = false;
          Object.keys(windows).forEach(function (key) { delete windows[key]; });
          windows[view || 'panel'] = win;
          watcher = new ClipboardWatcher({ getState: function () { return data; }, onEntry: function () {} });
        },
        addClip: addClipEntry,
        setupWatcher: function (snapshot) {
          data.settings.clipboardWatch = true;
          watcher = new ClipboardWatcher({ getState: function () { return data; },
            onEntry: function (payload) { addClipEntry(payload, '监听'); } });
          watcher.primed = true;
          watcher.snapshot = snapshot;
        },
        pollClipboard: function () { watcher.suspendUntil = 0; return watcher.poll(); },
        clipboardSignature: function () { return watcher.lastSig; },
        register: registerIpc
      };
    })`, { filename: mainFile });
    const handlers = load(function (id) {
      if (id === 'electron') return Object.assign({}, electron, {
        app: { isPackaged: true, requestSingleInstanceLock: () => true, on: () => {} },
        // Keep the user's system clipboard untouched while exercising production activation.
        clipboard: Object.assign({}, electron.clipboard, { writeText: async text => {
          if (clipboardFails) throw new Error('clipboard unavailable');
          clipboardText = text;
        } })
      });
      if (id === './state') return Object.assign({}, stateModule, { save: () => {} });
      if (id === './helper') return Object.assign({}, productionRequire(id), { pasteTo: async () => true });
      if (id === './ai') return aiMock;
      return productionRequire(id);
    }, path.dirname(mainFile));

    const win = new BrowserWindow({
      x: 120, y: 100, width: 660, height: 520, show: false, frame: false,
      transparent: true, resizable: false,
      webPreferences: {
        preload: path.join(root, 'electron', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false
      }
    });
    handlers.setup(win);
    handlers.register();
    const rendererErrors = [];
    win.webContents.on('console-message', function (event) {
      if (event.level === 'error') rendererErrors.push(event.message);
    });
    const evaluate = code => win.webContents.executeJavaScript(code);
    async function reset(view = 'panel', entries = []) {
      BrowserWindow.getAllWindows().forEach(other => { if (other !== win) other.destroy(); });
      win.hide();
      if (win.webContents.getURL()) await evaluate('window.platform.state.get()');
      win.setAlwaysOnTop(false);
      clipboardText = '';
      clipboardFails = false;
      aiCalls = [];
      aiBehavior = 'success';
      aiErrorDelay = 0;
      handlers.setup(win, entries, view);
      win.setBounds({ x: 120, y: 100, width: 660, height: 520 });
      await win.loadFile(path.join(root, 'src', 'index.html'), { query: { view: view } });
      // Hidden Windows Electron views report screenX/Y as zero after being shown once.
      // Supply the actual native starting bounds while keeping input tests off the desktop.
      const start = win.getBounds();
      await evaluate('Object.defineProperties(window, { screenX: { value: ' + start.x + ', configurable: true }, screenY: { value: ' + start.y + ', configurable: true } }); true');
      await evaluate(`document.querySelector('#panel').classList.remove('is-entering')`);
      await evaluate('document.fonts.ready.then(() => true)');
    }
    async function waitForView(view) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const found = BrowserWindow.getAllWindows().find(other =>
          other.webContents.getURL().includes('view=' + view));
        if (found && !found.webContents.isLoading() && found.isVisible()) return found;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('view did not open: ' + view);
    }
    async function pointer(selector, type, x, y, extra = {}) {
      return evaluate(`(async function () {
        document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent(
          ${JSON.stringify(type)}, Object.assign({ bubbles: true, cancelable: true,
            pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0,
            buttons: ${type === 'pointerup' ? 0 : 1}, screenX: ${x}, screenY: ${y}
          }, ${JSON.stringify(extra)})
        ));
        await Promise.resolve();
        await window.platform.state.get();
      })()`);
    }
    async function waitUntil(check, message, timeout = 3000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(message);
    }
    async function enableMockAI() {
      const current = await evaluate('window.platform.state.get()');
      current.settings.ai.baseUrl = 'http://mock.local/v1';
      current.settings.ai.apiKey = 'test-key';
      current.settings.ai.model = 'mock-model';
      current.settings.ai.connection = null;
      await evaluate('window.platform.state.set(' + JSON.stringify(current) + ')');
      await evaluate('window.platform.state.get()');
    }
    const tests = [];
    for (const pinned of [false, true]) {
      tests.push(['outside focus keeps the panel visible when pin=' + pinned, async () => {
        await evaluate('window.platform.window.setPin(' + pinned + ')');
        win.show();
        win.focus();
        const outside = new BrowserWindow({ width: 200, height: 120, show: false });
        try {
          const blurred = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('panel did not lose focus')), 3000);
            win.once('blur', () => { clearTimeout(timeout); resolve(); });
          });
          outside.show();
          outside.focus();
          await blurred;
          await evaluate('window.platform.state.get()');
          assert.equal(win.isVisible(), true);
          assert.equal(win.isMinimized(), false);
          assert.equal(win.isAlwaysOnTop(), pinned);
        } finally {
          outside.destroy();
        }
      }]);
      tests.push(['using a phrase only hides an unpinned panel when pin=' + pinned, async () => {
        await evaluate('window.platform.window.setPin(' + pinned + ')');
        win.show();
        const item = (await evaluate('window.platform.state.get()')).items.find(item => item.type === 'text');
        const result = await evaluate('window.platform.snippet.activate(' + JSON.stringify(item.id) + ')');
        assert.equal(result.ok, true);
        assert.equal(clipboardText, item.content);
        assert.equal(win.isVisible(), pinned);
        assert.equal(win.isMinimized(), false);
        assert.equal(win.isAlwaysOnTop(), pinned);
      }]);
      tests.push(['an older state save cannot change the pin from ' + pinned, async () => {
        await evaluate('window.platform.window.setPin(' + !pinned + ')');
        const stale = await evaluate('window.platform.state.get()');
        await evaluate('window.platform.window.setPin(' + pinned + ')');
        stale.settings.theme = 'dark';
        await evaluate('window.platform.state.set(' + JSON.stringify(stale) + ')');
        const saved = await evaluate('window.platform.state.get()');
        assert.equal(saved.settings.theme, 'dark');
        assert.equal(saved.settings.pin, pinned);
        assert.equal(win.isAlwaysOnTop(), pinned);
        assert.equal(await evaluate(`document.querySelector('#pinBtn').classList.contains('is-on')`), pinned);
      }]);
    }
    tests.push(['failed phrase copying leaves an unpinned panel open', async () => {
      clipboardFails = true;
      win.show();
      const item = (await evaluate('window.platform.state.get()')).items.find(item => item.type === 'text');
      const result = await evaluate('window.platform.snippet.activate(' + JSON.stringify(item.id) + ')');
      assert.equal(result.ok, false);
      assert.equal(win.isVisible(), true);
    }]);
    tests.push(['the pin switch in settings still locks and unlocks the panel', async () => {
      for (const pinned of [true, false]) {
        await evaluate(`document.querySelector('.switch[data-setting="pin"]').click()`);
        const saved = await evaluate('window.platform.state.get()');
        assert.equal(saved.settings.pin, pinned);
        assert.equal(win.isAlwaysOnTop(), pinned);
      }
    }]);
    tests.push(['all eight resize hit areas receive the mouse with the right cursor', async () => {
      const hits = await evaluate(`Array.from(document.querySelectorAll('.rz')).map(function (handle) {
        var r = handle.getBoundingClientRect();
        return { dir: handle.dataset.dir, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === handle,
          cursor: getComputedStyle(handle).cursor };
      })`);
      assert.deepEqual(hits, [
        { dir: 'n', hit: true, cursor: 'ns-resize' },
        { dir: 's', hit: true, cursor: 'ns-resize' },
        { dir: 'w', hit: true, cursor: 'ew-resize' },
        { dir: 'e', hit: true, cursor: 'ew-resize' },
        { dir: 'nw', hit: true, cursor: 'nwse-resize' },
        { dir: 'ne', hit: true, cursor: 'nesw-resize' },
        { dir: 'sw', hit: true, cursor: 'nesw-resize' },
        { dir: 'se', hit: true, cursor: 'nwse-resize' }
      ]);
    }]);
    for (const [view, rootSelector] of [
      ['launcher', '#launcherWindow'], ['aiHub', '#aiHubWindow'], ['aiPrefs', '#aiPrefsWindow'], ['clip', '#clipWindow'],
      ['petSettings', '#petWindow'], ['aiDialog', '#aiWindow']
    ]) {
      tests.push([view + ' window can be resized from its edge', async () => {
        await reset(view);
        const handleHits = await evaluate(`Array.from(document.querySelectorAll('.rz')).every(function (handle) {
          var rect = handle.getBoundingClientRect();
          return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === handle;
        })`);
        assert.equal(handleHits, true);
        await pointer('.rz-e', 'pointerdown', 400, 300);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rootSelector)}).classList.contains('is-resizing')`), true);
        await pointer('.rz-e', 'pointerup', 420, 300);
        assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 680, height: 520 });
      }]);
    }
    tests.push(['each function window can be dragged independently', async () => {
      for (const [view, selector] of [
        ['launcher', '#launcherWindow .launcher-head'],
        ['aiHub', '#aiHubWindow .func-head'],
        ['aiPrefs', '#aiPrefsWindow .func-head'],
        ['clip', '#clipWindow .func-head'],
        ['petSettings', '#petWindow .func-head'],
        ['aiDialog', '#aiWindow .ai-head']
      ]) {
        await reset(view);
        await pointer(selector, 'pointerdown', 400, 300);
        await pointer(selector, 'pointermove', 424, 320);
        await pointer(selector, 'pointerup', 424, 320);
        assert.deepEqual(win.getBounds(), { x: 144, y: 120, width: 660, height: 520 });
      }
    }]);
    tests.push(['opening another page replaces the previous page instead of stacking', async () => {
      await reset('panel');
      win.showInactive();
      await evaluate(`window.platform.nav.open('clip')`);
      await waitForView('clip');
      const visible = BrowserWindow.getAllWindows().filter(other => other.isVisible()).map(other => other.webContents.getURL());
      assert.equal(visible.some(url => /view=panel(?:&|$)/.test(url)), false);
      assert.equal(visible.some(url => /view=clip(?:&|$)/.test(url)), true);
    }]);
    for (const [dir, want] of [
      ['n', { x: 120, y: 120, width: 660, height: 500 }],
      ['s', { x: 120, y: 100, width: 660, height: 540 }],
      ['w', { x: 144, y: 100, width: 636, height: 520 }],
      ['e', { x: 120, y: 100, width: 684, height: 520 }],
      ['nw', { x: 144, y: 120, width: 636, height: 500 }],
      ['ne', { x: 120, y: 120, width: 684, height: 500 }],
      ['sw', { x: 144, y: 100, width: 636, height: 540 }],
      ['se', { x: 120, y: 100, width: 684, height: 540 }]
    ]) {
      tests.push(['resize ' + dir + ' exclusively, preserving the opposite edge on release', async () => {
        const selector = '.rz-' + dir;
        await pointer(selector, 'pointerdown', 400, 300);
        assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), false);
        assert.equal(await evaluate(`document.querySelector('#panel').classList.contains('is-resizing')`), true);
        await pointer(selector, 'pointermove', 424, 320);
        await pointer(selector, 'pointerup', 424, 320);
        assert.deepEqual(win.getBounds(), want);
        const state = await evaluate('window.platform.state.get()');
        assert.equal(state.settings.panelW, want.width - 60);
        assert.equal(state.settings.panelH, want.height - 60);
      }]);
    }
    tests.push(['final resize keeps the last movement even inside the live-update throttle', async () => {
      await pointer('#resizeGrip', 'pointerdown', 400, 300);
      await evaluate(`(function () {
        var grip = document.querySelector('#resizeGrip');
        ['pointermove', 'pointermove', 'pointerup'].forEach(function (type, i) {
          grip.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1,
            screenX: i ? 448 : 424, screenY: i ? 340 : 320, button: 0 }));
        });
      })()`);
      await evaluate('window.platform.state.get()');
      assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 708, height: 560 });
    }]);
    tests.push(['another pointer cannot move or finish an active resize', async () => {
      await pointer('#resizeGrip', 'pointerdown', 400, 300);
      await pointer('#resizeGrip', 'pointermove', 450, 350, { pointerId: 2 });
      await pointer('#resizeGrip', 'pointerup', 450, 350, { pointerId: 2 });
      assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 660, height: 520 });
      assert.equal(await evaluate(`document.querySelector('#panel').classList.contains('is-resizing')`), true);
      await pointer('#resizeGrip', 'pointerup', 400, 300);
    }]);
    for (const ending of ['pointercancel', 'lostpointercapture', 'blur']) {
      tests.push(['resize cleans up after ' + ending, async () => {
        await pointer('#resizeGrip', 'pointerdown', 400, 300);
        if (ending === 'blur') await evaluate(`window.dispatchEvent(new Event('blur'))`);
        else await pointer('#resizeGrip', ending, 400, 300);
        assert.equal(await evaluate(`document.querySelector('#panel').classList.contains('is-resizing')`), false);
        await pointer('#resizeGrip', 'pointermove', 450, 350);
        assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 660, height: 520 });
      }]);
    }
    tests.push(['title bar dragging applies the final movement before release', async () => {
      await pointer('.panel-head', 'pointerdown', 400, 300);
      await pointer('.panel-head', 'pointermove', 424, 320);
      await pointer('.panel-head', 'pointerup', 424, 320);
      assert.deepEqual(win.getBounds(), { x: 144, y: 120, width: 660, height: 520 });
      assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), false);
    }]);
    tests.push(['transparent margin still starts window dragging', async () => {
      await pointer('body', 'pointerdown', 400, 300);
      assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), true);
      await pointer('body', 'pointerup', 400, 300);
    }]);
    tests.push(['buttons and content do not start window dragging', async () => {
      for (const selector of ['#menuBtn', '#searchInput', '#list']) {
        await pointer(selector, 'pointerdown', 400, 300);
        assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), false);
        await pointer(selector, 'pointerup', 400, 300);
      }
    }]);
    tests.push(['saving settings after resize preserves both size and position', async () => {
      await pointer('.rz-nw', 'pointerdown', 400, 300);
      await pointer('.rz-nw', 'pointerup', 424, 320);
      await evaluate(`(async function () {
        var state = await window.platform.state.get();
        state.settings.theme = 'dark';
        await window.platform.state.set(state);
      })()`);
      assert.deepEqual(win.getBounds(), { x: 144, y: 120, width: 636, height: 500 });
    }]);
    tests.push(['minimum height stays stable when unrelated settings are saved', async () => {
      await pointer('.rz-n', 'pointerdown', 400, 300);
      await pointer('.rz-n', 'pointerup', 400, 600);
      const before = win.getBounds();
      await evaluate(`(async function () {
        var state = await window.platform.state.get();
        state.settings.theme = 'dark';
        await window.platform.state.set(state);
      })()`);
      assert.deepEqual(win.getBounds(), before);
    }]);
    tests.push(['native mouse input captures the resize pointer until release', async () => {
      win.hide();
      const point = await evaluate(`(function () {
        var r = document.querySelector('.rz-e').getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`);
      const start = { ...point, globalX: 120 + point.x, globalY: 100 + point.y };
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
      win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
      await evaluate('window.platform.state.get()');
      assert.equal(await evaluate(`document.documentElement.hasPointerCapture(1)`), true);
      const end = { x: point.x + 12, y: point.y + 10, globalX: start.globalX + 12, globalY: start.globalY + 10 };
      win.webContents.sendInputEvent({ type: 'mouseMove', ...end, button: 'left' });
      win.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
      await evaluate(`new Promise(function (resolve, reject) {
        var deadline = Date.now() + 3000;
        function check() {
          window.platform.state.get().then(function (state) {
            if (!document.querySelector('#panel').classList.contains('is-resizing') && state.settings.panelW === 612) resolve();
            else if (Date.now() > deadline) reject(new Error('native resize did not finish'));
            else setTimeout(check, 10);
          }, reject);
        }
        check();
      })`);
      assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 672, height: 520 });
      assert.equal(await evaluate(`document.querySelector('#panel').classList.contains('is-resizing')`), false);
      assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), false);
    }]);

    tests.push(['moving across a resize edge keeps the window size locked', async () => {
      await pointer('.panel-head', 'pointerdown', 400, 300);
      await pointer('.rz-se', 'pointerdown', 400, 300);
      await pointer('.rz-se', 'pointermove', 440, 330);
      await pointer('.rz-se', 'pointerup', 440, 330);
      assert.deepEqual(win.getBounds(), { x: 160, y: 130, width: 660, height: 520 });
      assert.equal(await evaluate(`document.querySelector('#panel').classList.contains('is-resizing')`), false);
    }]);
    tests.push(['resizing across the title bar never starts the move gesture', async () => {
      await pointer('.rz-se', 'pointerdown', 400, 300);
      await pointer('.panel-head', 'pointerdown', 400, 300);
      await pointer('.panel-head', 'pointermove', 440, 330);
      await pointer('.panel-head', 'pointerup', 440, 330);
      assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 700, height: 550 });
      assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), false);
    }]);
    tests.push(['a panel edge always resizes even when another layer receives pointerdown', async () => {
      const edge = await evaluate(`(function () {
        var r = document.querySelector('#panel').getBoundingClientRect();
        return { x: Math.round(r.right + 4), y: Math.round(r.top + r.height / 2) };
      })()`);
      await pointer('body', 'pointerdown', 120 + edge.x, 100 + edge.y,
        { clientX: edge.x, clientY: edge.y });
      assert.equal(await evaluate(`document.documentElement.classList.contains('is-window-dragging')`), false);
      assert.equal(await evaluate(`document.querySelector('#panel').classList.contains('is-resizing')`), true);
      await pointer('body', 'pointermove', 140 + edge.x, 100 + edge.y,
        { clientX: edge.x + 20, clientY: edge.y });
      await pointer('body', 'pointerup', 140 + edge.x, 100 + edge.y,
        { clientX: edge.x + 20, clientY: edge.y });
      assert.deepEqual(win.getBounds(), { x: 120, y: 100, width: 680, height: 520 });
    }]);
    tests.push(['native resize IPC is ignored once a window move has started', async () => {
      await evaluate(`(async function () {
        window.platform.window.dragStart(400, 300);
        window.platform.window.dragMove(450, 350);
        window.platform.window.resizePanelLive(900, 800, 200, 200);
        await window.platform.state.get();
      })()`);
      assert.deepEqual(win.getBounds(), { x: 170, y: 150, width: 660, height: 520 });
      await evaluate('window.platform.window.dragEnd()');
    }]);
    tests.push(['window size is restored on every move after drag lock', async () => {
      await evaluate(`(async function () {
        window.platform.window.dragStart(400, 300);
        window.platform.window.dragMove(430, 330);
        await window.platform.state.get();
      })()`);
      win.setSize(900, 800);
      await evaluate(`(async function () {
        window.platform.window.dragMove(460, 360);
        await window.platform.state.get();
      })()`);
      await evaluate('window.platform.window.dragEnd()');
      assert.deepEqual(win.getBounds(), { x: 180, y: 160, width: 660, height: 520 });
    }]);
    tests.push(['native move IPC is ignored once a resize has started', async () => {
      await evaluate(`(async function () {
        window.platform.window.resizePanelLive(720, 580, 140, 120);
        window.platform.window.dragStart(400, 300);
        window.platform.window.dragMove(500, 400);
        await window.platform.state.get();
      })()`);
      assert.deepEqual(win.getBounds(), { x: 140, y: 120, width: 720, height: 580 });
      await evaluate('window.platform.window.resizePanel(600, 460, 120, 100)');
    }]);
    tests.push(['legacy images without signatures are deduplicated without moving the entry', async () => {
      const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
      await reset('panel', [{ id: 'legacy-image', type: 'image', content: '', sig: '',
        image: 'data:image/png;base64,' + buffer.toString('base64'), source: '导入', createdAt: 1700000000000 }]);
      assert.equal(handlers.addClip({ type: 'image', buffer: buffer }, '监听'), false);
      const state = await evaluate('window.platform.state.get()');
      assert.equal(state.clipboard.length, 1);
      assert.equal(state.clipboard[0].id, 'legacy-image');
    }]);

    const textSig = text => 't:' + require('node:crypto').createHash('sha1').update(text).digest('hex');
    const history = () => Array.from({ length: 24 }, (_, i) => ({
      id: 'clip-' + i, type: 'text', content: 'History item ' + i + ' with some details',
      sig: textSig('History item ' + i + ' with some details'), source: '监听', createdAt: 1700000000000 - i * 1000
    }));
    const clipImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const imageHistory = () => [{
      id: 'clip-image', type: 'image', content: '', image: clipImage,
      sig: '', source: '监听', createdAt: 1700000001000
    }].concat(history());
    async function addLiveEntry() {
      handlers.addClip({ type: 'text', content: 'A genuinely new copy', sig: textSig('A genuinely new copy') }, '监听');
      await evaluate('window.platform.state.get()');
    }
    tests.push(['copying old history is not recorded again after the suspension expires', async () => {
      await reset('clip', history());
      handlers.setupWatcher(async () => ({ type: 'text', content: clipboardText, sig: textSig(clipboardText) }));
      await evaluate(`window.platform.clipboard.copy('clip-8')`);
      assert.equal(handlers.clipboardSignature(), textSig(clipboardText));
      await handlers.pollClipboard();
      const state = await evaluate('window.platform.state.get()');
      assert.equal(state.clipboard.length, 24);
      assert.equal(state.clipboard[0].id, 'clip-0');
      assert.equal(state.clipboard[8].id, 'clip-8');
    }]);
    tests.push(['duplicates anywhere in history keep the existing entry and order', async () => {
      const entries = history();
      await reset('clip', entries);
      assert.equal(handlers.addClip({ type: 'text', content: entries[8].content, sig: entries[8].sig }, '监听'), false);
      const state = await evaluate('window.platform.state.get()');
      assert.deepEqual(state.clipboard.map(entry => entry.id), entries.map(entry => entry.id));
    }]);
    tests.push(['an update does not replace the history button being pressed', async () => {
      await reset('clip', history());
      await evaluate(`window.__historyButton = document.querySelector('.clip-item[data-clip-id="clip-0"] [data-clip-action="copy"]')`);
      await addLiveEntry();
      assert.equal(await evaluate('window.__historyButton.isConnected'), true);
    }]);
    tests.push(['live insertion preserves the row under the mouse', async () => {
      await reset('clip', history());
      const selector = '.clip-item[data-clip-id="clip-0"]';
      await pointer(selector, 'pointerover', 400, 300);
      const before = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`);
      await addLiveEntry();
      const after = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`);
      assert.ok(Math.abs(after - before) <= 1, 'hovered history moved by ' + (after - before) + 'px');
    }]);
    tests.push(['live insertion preserves the scroll position while browsing older history', async () => {
      await reset('clip', history());
      const before = await evaluate(`(function () {
        var body = document.querySelector('#clipWindow .func-body');
        body.scrollTop = 600;
        var top = body.getBoundingClientRect().top;
        var row = Array.from(document.querySelectorAll('.clip-item')).find(function (r) { return r.getBoundingClientRect().bottom > top; });
        return { id: row.dataset.clipId, top: row.getBoundingClientRect().top };
      })()`);
      await addLiveEntry();
      const after = await evaluate(`document.querySelector('.clip-item[data-clip-id="${before.id}"]').getBoundingClientRect().top`);
      assert.ok(Math.abs(after - before.top) <= 1, 'visible history moved by ' + (after - before.top) + 'px');
    }]);
    tests.push(['deleting a history entry uses the main-process removal handler', async () => {
      await reset('clip', history());
      await evaluate(`document.querySelector('.clip-item[data-clip-id="clip-8"] [data-clip-action="delete"]').click()`);
      const state = await evaluate('window.platform.state.get()');
      assert.equal(state.clipboard.some(entry => entry.id === 'clip-8'), false);
      assert.equal(await evaluate(`!!document.querySelector('.clip-item[data-clip-id="clip-8"]')`), false);
    }]);

    for (const [view, selector] of [
      ['panel', '#closeBtn'], ['launcher', '#launcherClose'], ['aiHub', '#aiHubWindow .func-head > button:last-child'],
      ['aiPrefs', '#aiPrefsWindow .func-head > button:last-child'],
      ['clip', '#clipWindow .func-head > button:last-child'], ['petSettings', '#petWindow .func-head > button:last-child'],
      ['aiDialog', '#aiCloseBtn']
    ]) {
      tests.push(['right-hand close hides ' + view + ' without opening another page', async () => {
        await reset(view);
        win.setPosition(-10000, -10000);
        win.showInactive();
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await evaluate('window.platform.state.get()');
        assert.equal(win.isVisible(), false);
        assert.equal(BrowserWindow.getAllWindows().filter(other => other.isVisible()).length, 0);
        assert.equal(BrowserWindow.getAllWindows().length, 1);
      }]);
    }

    tests.push(['custom personas can be named, saved, selected and edited from the AI dialog', async () => {
      await reset('aiDialog');
      await evaluate("document.querySelector('[data-add-persona]').click()");
      assert.equal(await evaluate("document.querySelector('#presetLayer').classList.contains('is-open')"), true);
      await evaluate("document.querySelector('#presetName').value = '测试审稿人'; document.querySelector('#presetText').value = '逐项指出证据不足，并给出可验证的修改建议。'; document.querySelector('#presetEditorSave').click()");
      await evaluate('Promise.resolve().then(() => window.platform.state.get())');
      const saved = await evaluate('window.platform.state.get()');
      const persona = saved.personas.find(item => item.name === '测试审稿人');
      assert.ok(persona);
      assert.equal(saved.settings.personaId, persona.id);
      assert.equal(persona.text, '逐项指出证据不足，并给出可验证的修改建议。');
      await evaluate('document.querySelector(\'[data-edit-preset="persona"][data-preset-id="' + persona.id + '"]\').click()');
      assert.equal(await evaluate("document.querySelector('#presetText').value"), persona.text);
      await evaluate("document.querySelector('#presetText').value = '编辑后的完整角色指令'; document.querySelector('#presetEditorSave').click()");
      const edited = await evaluate('Promise.resolve().then(() => window.platform.state.get())');
      assert.equal(edited.personas.find(item => item.id === persona.id).text, '编辑后的完整角色指令');
    }]);
    tests.push(['custom task prompts use separate names and multiline instructions', async () => {
      await reset('aiDialog');
      await evaluate("document.querySelector('[data-add-prompt]').click()");
      const prefs = await waitForView('aiPrefs');
      await prefs.webContents.executeJavaScript("document.querySelector('#aiPrefNewPrompt').click(); document.querySelector('#aiPrefPromptName').value='论点检查'; document.querySelector('#aiPrefPromptText').value='第一步检查论点。第二步列出反例。'; document.querySelector('#aiPrefPromptEditor').requestSubmit()");
      const saved = await evaluate('Promise.resolve().then(() => window.platform.state.get())');
      const prompt = saved.prompts.find(item => item.name === '论点检查');
      assert.ok(prompt);
      assert.equal(saved.settings.promptId, prompt.id);
      const useSelector = `[data-ai-pref-prompt-use="${prompt.id}"]`;
      assert.equal(await prefs.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(useSelector)}).textContent`), '使用中');
    }]);
    tests.push(['AI persona editor stays above the dialog in the same window', async () => {
      await reset('aiDialog');
      await evaluate("document.querySelector('[data-add-persona]').click()");
      const state = await evaluate(`(function () {
        var layer = document.querySelector('#presetLayer');
        var modal = layer.querySelector('.modal');
        var ai = document.querySelector('#aiWindow');
        var rect = modal.getBoundingClientRect();
        var top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          open: layer.classList.contains('is-open'),
          editorVisible: !document.querySelector('#presetEditor').hidden,
          layerZ: Number(getComputedStyle(layer).zIndex),
          aiZ: Number(getComputedStyle(ai).zIndex),
          modalIsTop: !!(top && top.closest('#presetLayer')),
          contained: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
        };
      })()`);
      assert.equal(state.open, true);
      assert.equal(state.editorVisible, true);
      assert.ok(state.layerZ > state.aiZ);
      assert.equal(state.modalIsTop, true);
      assert.equal(state.contained, true);
    }]);
    tests.push(['AI answer settings open in a separate window and persist supplemental context', async () => {
      await reset('aiHub');
      win.showInactive();
      await evaluate("document.querySelector('[data-manage-presets]').click()");
      const prefs = await waitForView('aiPrefs');
      assert.equal(win.isVisible(), false);
      assert.equal(prefs.isVisible(), true);
      await prefs.webContents.executeJavaScript("var input=document.querySelector('#aiUserContextInput'); input.value='回答时先给结论，不使用 Markdown。'; input.dispatchEvent(new Event('input',{bubbles:true}))");
      await new Promise(resolve => setTimeout(resolve, 450));
      const saved = await evaluate('window.platform.state.get()');
      assert.equal(saved.settings.ai.userContext, '回答时先给结论，不使用 Markdown。');
    }]);
    tests.push(['starting chat from AI home hides its landing window instead of stacking behind it', async () => {
      await reset('aiHub');
      win.showInactive();
      await evaluate("document.querySelector('#aiPageChat').click()");
      const dialog = await waitForView('aiDialog');
      assert.equal(dialog.isVisible(), true);
      assert.equal(win.isVisible(), false);
    }]);
    tests.push(['pet settings merges reply sequences into editable enabled scenes', async () => {
      await reset('petSettings');
      await evaluate(`document.querySelector('[data-pet-tab="scenes"]').click()`);
      const tabs = await evaluate(`Array.from(document.querySelectorAll('#petTabs button')).map(function (button) {
        return button.textContent.trim();
      })`);
      assert.deepEqual(tabs, ['桌宠', '接话小剧场', '添加']);
      assert.equal(await evaluate(`document.querySelectorAll('[data-pet-view="scenes"]').length`), 1);
      assert.equal(await evaluate(`document.querySelectorAll('[data-pet-view="rules"], [data-pet-view="theater"]').length`), 0);

      const initial = await evaluate('window.platform.state.get()');
      assert.equal(initial.replyScenes.length, 2);
      await evaluate(`document.querySelector('#petSceneAdd').click()`);
      await new Promise(resolve => setTimeout(resolve, 80));

      const created = await evaluate('window.platform.state.get()');
      const scene = created.replyScenes[created.replyScenes.length - 1];
      assert.ok(scene && scene.enabled);
      assert.equal(scene.steps.length, 1);
      assert.equal(scene.steps[0].petId, created.pets[0].id);

      const selector = '[data-scene-id="' + scene.id + '"]';
      await evaluate(`(function () {
        var card = document.querySelector(${JSON.stringify(selector)});
        var input = card.querySelector('[data-scene-name]');
        input.value = '邵艾伦随机版';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      await evaluate(`(function () {
        var card = document.querySelector(${JSON.stringify(selector)});
        var select = card.querySelector('[data-step-field="petId"]');
        select.value = 'shaolan';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.match(await evaluate(`document.querySelector(${JSON.stringify(selector)} + ' .pet-scene-meta').textContent`), /邵艾伦/);
      await evaluate(`document.querySelector(${JSON.stringify(selector)} + ' [data-scene-enabled]').click()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      await evaluate(`document.querySelector(${JSON.stringify(selector)} + ' [data-scene-action="add-step"]').click()`);
      await new Promise(resolve => setTimeout(resolve, 80));

      const edited = await evaluate('window.platform.state.get()');
      const saved = edited.replyScenes.find(item => item.id === scene.id);
      assert.equal(saved.name, '邵艾伦随机版');
      assert.equal(saved.enabled, false);
      assert.equal(saved.steps.length, 2);
      assert.equal(saved.steps[0].petId, 'shaolan');
      assert.equal(saved.steps[1].petId, 'shaolan');
    }]);
    tests.push(['clipboard search and full text preview operate on actual history', async () => {
      await reset('clip', history());
      await evaluate("document.querySelector('#clipSearch').value='History item 8'; document.querySelector('#clipSearch').dispatchEvent(new Event('input'))");
      assert.equal(await evaluate("document.querySelectorAll('.clip-item').length"), 1);
      await evaluate("document.querySelector('.clip-item [data-clip-action=view]').click()");
      assert.equal(await evaluate("document.querySelector('#clipViewer').hidden"), false);
      assert.equal(await evaluate("document.querySelector('#clipViewerText').textContent"), 'History item 8 with some details');
      assert.equal(await evaluate(`(function () {
        var text = document.querySelector('#clipViewerText');
        var rect = text.getBoundingClientRect();
        var top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !!top && !!top.closest('#clipViewer');
      })()`), true);
    }]);
    tests.push(['clipboard image preview stays above history and supports controlled zoom', async () => {
      await reset('clip', imageHistory());
      await evaluate("document.querySelector('.clip-item[data-clip-id=\"clip-image\"] [data-clip-action=\"view\"]').click()");
      await evaluate(`new Promise(function (resolve) {
        var image = document.querySelector('#clipViewerImg');
        if (image.complete) resolve(true);
        else image.addEventListener('load', function () { resolve(true); }, { once: true });
      })`);
      const placement = await evaluate(`(function () {
        var viewer = document.querySelector('#clipViewer');
        var card = viewer.querySelector('.clip-viewer-card');
        var close = viewer.querySelector('.clip-viewer-head [data-close-clip-viewer]');
        var controls = document.querySelector('#clipViewerControls');
        var cardRect = card.getBoundingClientRect();
        var closeRect = close.getBoundingClientRect();
        var hit = document.elementFromPoint(cardRect.left + cardRect.width / 2, cardRect.top + 24);
        var closeHit = document.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2);
        return {
          open: !viewer.hidden,
          cardTop: !!hit && card.contains(hit),
          closeTop: !!closeHit && (close === closeHit || close.contains(closeHit)),
          hasControls: !!controls && !controls.hidden,
          hit: hit ? (hit.id || hit.className || hit.tagName) : ''
        };
      })()`);
      assert.equal(placement.open, true);
      assert.equal(placement.cardTop, true, 'image card is covered: ' + JSON.stringify(placement));
      assert.equal(placement.closeTop, true, 'close button is covered: ' + JSON.stringify(placement));
      assert.equal(placement.hasControls, true);

      const fitted = await evaluate(`(function () {
        var stage = document.querySelector('#clipViewerStage');
        var image = document.querySelector('#clipViewerImg');
        var controls = document.querySelector('#clipViewerControls');
        var stageRect = stage.getBoundingClientRect();
        var imageRect = image.getBoundingClientRect();
        var controlsRect = controls.getBoundingClientRect();
        var naturalRatio = image.naturalWidth / image.naturalHeight;
        var visualRatio = imageRect.width / imageRect.height;
        return {
          label: document.querySelector('#clipViewerZoomLabel').textContent.trim(),
          imageVisible: imageRect.width > 0 && imageRect.height > 0,
          aspectMatches: Math.abs(naturalRatio - visualRatio) < 0.01,
          imageInside: imageRect.left >= stageRect.left - 1 && imageRect.top >= stageRect.top - 1 &&
            imageRect.right <= stageRect.right + 1 && imageRect.bottom <= stageRect.bottom + 1,
          controlsInside: controlsRect.left >= 0 && controlsRect.right <= innerWidth &&
            controlsRect.bottom <= innerHeight,
          controlsOverflow: controls.scrollWidth > controls.clientWidth + 1
        };
      })()`);
      assert.equal(fitted.label, '100%');
      assert.equal(fitted.imageVisible, true);
      assert.equal(fitted.aspectMatches, true);
      assert.equal(fitted.imageInside, true);
      assert.equal(fitted.controlsInside, true);
      assert.equal(fitted.controlsOverflow, false);

      await evaluate("document.querySelector('#clipViewerZoomIn').click()");
      const zoomed = await evaluate(`(function () {
        var stage = document.querySelector('#clipViewerStage');
        return {
          label: document.querySelector('#clipViewerZoomLabel').textContent.trim(),
          scrolls: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight
        };
      })()`);
      assert.equal(zoomed.label, '125%');
      assert.equal(zoomed.scrolls, true);
      await evaluate("document.querySelector('#clipViewerZoomFit').click()");
      assert.equal(await evaluate("document.querySelector('#clipViewerZoomLabel').textContent.trim()"), '100%');

      await evaluate("document.querySelector('#clipViewerClose').click()");
      assert.equal(await evaluate("document.querySelector('#clipViewer').hidden"), true);
      await evaluate("document.querySelector('.clip-item[data-clip-id=\"clip-image\"] [data-clip-action=\"view\"]').click()");
      assert.equal(await evaluate("document.querySelector('#clipViewerZoomLabel').textContent.trim()"), '100%');
      await evaluate("document.querySelector('#clipViewerZoomIn').click()");
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      assert.equal(await evaluate("document.querySelector('#clipViewer').hidden"), true);
      await evaluate("document.querySelector('.clip-item[data-clip-id=\"clip-image\"] [data-clip-action=\"view\"]').click()");
      assert.equal(await evaluate("document.querySelector('#clipViewerZoomLabel').textContent.trim()"), '100%');

      win.setBounds({ x: 120, y: 100, width: 380, height: 500 });
      await evaluate("document.documentElement.dataset.theme = 'dark'");
      await new Promise(resolve => setTimeout(resolve, 80));
      const narrow = await evaluate(`(function () {
        var card = document.querySelector('#clipViewer .clip-viewer-card');
        var close = document.querySelector('#clipViewerClose');
        var controls = document.querySelector('#clipViewerControls');
        var cardRect = card.getBoundingClientRect();
        var closeRect = close.getBoundingClientRect();
        return {
          cardInside: cardRect.left >= 0 && cardRect.top >= 0 && cardRect.right <= innerWidth && cardRect.bottom <= innerHeight,
          closeInside: closeRect.left >= 0 && closeRect.top >= 0 && closeRect.right <= innerWidth && closeRect.bottom <= innerHeight,
          controlsOverflow: controls.scrollWidth > controls.clientWidth + 1
        };
      })()`);
      assert.equal(narrow.cardInside, true);
      assert.equal(narrow.closeInside, true);
      assert.equal(narrow.controlsOverflow, false);
    }]);

    tests.push(['AI composer exposes selected persona and prompt text as one editable template', async () => {
      await reset('aiDialog');
      const state = await evaluate('window.platform.state.get()');
      const persona = state.personas.find(item => item.id === state.settings.personaId);
      const prompt = state.prompts.find(item => item.id === state.settings.promptId);
      const initial = await evaluate("document.querySelector('#aiQuestion').value");
      assert.ok(initial.includes(persona.text));
      assert.ok(initial.includes(prompt.text));

      await evaluate("document.querySelector('[data-persona=\"translator\"]').click()");
      const switchedPersona = await evaluate("document.querySelector('#aiQuestion').value");
      assert.ok(switchedPersona.includes('你是专业翻译。默认在中英文之间互译，保留原文语气，专有名词给出对照。'));
      assert.ok(!switchedPersona.includes(persona.text));
      assert.ok(switchedPersona.includes(prompt.text));

      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value += '\\n\\n保留这段我自己追加的要求。';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value;
      })()`);
      await evaluate("document.querySelector('[data-prompt=\"translate\"]').click()");
      const switchedPrompt = await evaluate("document.querySelector('#aiQuestion').value");
      assert.ok(switchedPrompt.includes('把选中内容翻译成自然的英文，保留语气。'));
      assert.ok(!switchedPrompt.includes(prompt.text));
      assert.ok(switchedPrompt.includes('保留这段我自己追加的要求。'));
    }]);

    tests.push(['AI composer sends only its visible edited text and retries the same snapshot', async () => {
      await reset('aiDialog');
      await enableMockAI();
      const visible = '只保留这段人设。\n\n只保留这段任务，不再发送旧模板。';
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = ${JSON.stringify(visible)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#aiSendBtn').click();
      })()`);
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), '');
      await waitUntil(() => aiCalls.length === 1, 'AI request did not start');
      assert.equal(aiCalls[0].mode, 'editor');
      assert.equal(aiCalls[0].question, visible);
      assert.equal(aiCalls[0].persona, null);
      assert.equal(aiCalls[0].prompt, null);

      await waitUntil(async () => {
        return !(await evaluate("document.querySelector('#aiSendBtn').classList.contains('is-stop')"));
      }, 'AI request did not finish');
      await evaluate("document.querySelector('#aiRetryBtn').click()");
      await waitUntil(() => aiCalls.length === 2, 'AI retry did not start');
      assert.equal(aiCalls[1].question, visible);
      assert.equal(aiCalls[1].mode, 'editor');
    }]);

    tests.push(['AI composer stays empty after a broadcast and refills only on an explicit preset click', async () => {
      await reset('aiDialog');
      await enableMockAI();
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = '发送后会清空的文本';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#aiSendBtn').click();
      })()`);
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), '');
      await waitUntil(() => aiCalls.length === 1, 'AI request did not start');
      const state = await evaluate('window.platform.state.get()');
      win.webContents.send('state:changed', state);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), '');

      const personaId = state.settings.personaId;
      await evaluate(`document.querySelector('[data-persona="${personaId}"]').click()`);
      const refilled = await evaluate("document.querySelector('#aiQuestion').value");
      const persona = state.personas.find(item => item.id === personaId);
      const prompt = state.prompts.find(item => item.id === state.settings.promptId);
      assert.ok(refilled.includes(persona.text));
      assert.ok(refilled.includes(prompt.text));
    }]);

    tests.push(['AI composer restores a failed draft without overwriting newer typing', async () => {
      await reset('aiDialog');
      await enableMockAI();
      aiBehavior = 'error';
      aiErrorDelay = 80;
      const firstDraft = '失败后应该恢复的草稿';
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = ${JSON.stringify(firstDraft)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#aiSendBtn').click();
      })()`);
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), '');
      await waitUntil(async () => {
        return (await evaluate("document.querySelector('#aiResultLabel').textContent")) === '未能完成';
      }, 'AI failure was not shown');
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), firstDraft);

      const secondDraft = '第二次失败前的草稿';
      const newerDraft = '失败后我自己继续写的新草稿';
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = ${JSON.stringify(secondDraft)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#aiSendBtn').click();
      })()`);
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), '');
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = ${JSON.stringify(newerDraft)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitUntil(() => aiCalls.length === 2, 'second AI request did not start');
      await waitUntil(async () => {
        return (await evaluate("document.querySelector('#aiResultLabel').textContent")) === '未能完成';
      }, 'second AI failure was not shown');
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), newerDraft);
    }]);

    tests.push(['AI composer keeps selected text attached when sending its edited template', async () => {
      await reset('aiDialog');
      await enableMockAI();
      await evaluate("window.platform.nav.open('aiDialog', { context: { type: 'text', text: '来自选区的原文' }, question: '' })");
      await waitUntil(async () => {
        return (await evaluate("document.querySelector('#aiCtxText').textContent")) === '来自选区的原文';
      }, 'selected text context did not arrive');
      const visible = '结合选区回答，并且只发送这一段。';
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = ${JSON.stringify(visible)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#aiSendBtn').click();
      })()`);
      await waitUntil(() => aiCalls.length === 1, 'AI context request did not start');
      assert.equal(aiCalls[0].question, visible);
      assert.equal(aiCalls[0].context.type, 'text');
      assert.equal(aiCalls[0].context.text, '来自选区的原文');
    }]);

    tests.push(['AI composer follows external preset edits without overwriting a local draft', async () => {
      await reset('aiDialog');
      const state = await evaluate('window.platform.state.get()');
      const prompt = state.prompts.find(item => item.id === state.settings.promptId);
      const oldText = prompt.text;
      prompt.text = '另一个窗口保存后的完整提示词。';
      win.webContents.send('state:changed', state);
      await new Promise(resolve => setTimeout(resolve, 80));
      const synced = await evaluate("document.querySelector('#aiQuestion').value");
      assert.ok(synced.includes(prompt.text));
      assert.ok(!synced.includes(oldText));

      const draft = synced + '\n\n这是我还没发送的本地草稿。';
      await evaluate(`(function () {
        var input = document.querySelector('#aiQuestion');
        input.value = ${JSON.stringify(draft)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      win.webContents.send('state:changed', state);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(await evaluate("document.querySelector('#aiQuestion').value"), draft);
    }]);

    require('./group-interactions.cjs')({ tests, reset, evaluate, pointer, win });

    let failures = 0;
    for (const [name, run] of tests) {
      try {
        await reset();
        await run();
        console.log('PASS ' + name);
      } catch (error) {
        failures++;
        console.error('FAIL ' + name + '\n' + error.stack);
      }
    }
    if (rendererErrors.length) {
      failures++;
      console.error('Renderer errors:', rendererErrors);
    }
    console.log((tests.length - failures) + '/' + tests.length + ' checks passed');
    if (!failures && process.argv.includes('--capture-product')) {
      const output = path.join(root, '.screenshots', 'product-' + Date.now());
      fs.mkdirSync(output, { recursive: true });
      for (const [view, theme] of [['launcher','light'], ['aiHub','light'], ['aiDialog','dark'], ['panel','light'], ['clip','light'], ['petSettings','light']]) {
        await reset(view, view === 'clip' ? history() : []);
        win.setBounds({ x: -10000, y: -10000, width: view === 'aiDialog' ? 632 : 740, height: view === 'aiDialog' ? 812 : 680 });
        const current = await evaluate('window.platform.state.get()');
        current.settings.theme = theme;
        current.settings.ai = { baseUrl: 'https://opencode.ai/inference/go/openai/v1', apiKey: 'preview-only', model: 'deepseek-v4.1-flash', connection: null };
        await evaluate('window.platform.state.set(' + JSON.stringify(current) + ')');
        await win.loadFile(path.join(root, 'src', 'index.html'), { query: { view } });
        await evaluate("document.querySelector('#panel').classList.remove('is-entering'); document.fonts.ready.then(() => true)");
        if (view === 'petSettings') await evaluate(`document.querySelector('[data-pet-tab="scenes"]').click()`);
        win.showInactive();
        let image;
        try {
          image = (await win.webContents.capturePage()).toPNG();
        } catch (error) {
          const debuggerApi = win.webContents.debugger;
          if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
          const shot = await debuggerApi.sendCommand('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true
          });
          image = Buffer.from(shot.data, 'base64');
        }
        fs.writeFileSync(path.join(output, view + '-' + theme + '.png'), image);
        win.hide();
      }
      console.log('Product screenshots: ' + output);
    }
    win.destroy();
    app.exit(failures ? 1 : 0);
  }).catch(error => {
    console.error(error);
    app.exit(1);
  });
}
