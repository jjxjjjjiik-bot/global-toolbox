/* ============================================================
   Electron 渲染端桥接
   - 尽早把当前窗口对应的视图写到 <html data-view>，避免闪一下别的面板
   - 浏览器直接打开时给一份空实现，原型仍可查看
   ============================================================ */
(function () {
  'use strict';

  var platform = window.platform || null;

  if (!platform) {
    var view = 'panel';
    try {
      var probe = new URLSearchParams(location.search).get('view');
      if (probe) view = probe;
    } catch (e) { /* ignore */ }
    platform = {
      env: { view: view, petId: '', displayId: '', platform: 'browser', electron: '' },
      state: {
        getSync: function () { return null; },
        get: function () { return Promise.resolve(null); },
        set: function () { return Promise.resolve({ ok: false }); },
        onChanged: function () { return function () { }; }
      },
      nav: {
        open: function () { return Promise.resolve({ ok: false }); },
        back: function () { return Promise.resolve({ ok: false }); },
        openSettings: function () { return Promise.resolve({ ok: false }); },
        closeAI: function () { return Promise.resolve({ ok: false }); },
        onSettings: function () { return function () { }; }
      },
      window: {
        hide: function () { return Promise.resolve({ ok: false }); },
        quit: function () { return Promise.resolve({ ok: false }); },
        setPin: function () { return Promise.resolve({ ok: false }); },
        resizePanel: function () { return Promise.resolve({ ok: false }); },
        resizeWindow: function () { return Promise.resolve({ ok: false }); },
        setPanelSize: function () { return Promise.resolve({ ok: false }); },
        onPanelSize: function () { return function () { }; }
      },
      snippet: {
        activate: function () { return Promise.resolve({ ok: false }); },
        copy: function () { return Promise.resolve({ ok: false }); }
      },
      media: { saveImage: function () { return Promise.resolve({ ok: false }); } },
      clipboard: {
        copy: function () { return Promise.resolve({ ok: false }); },
        paste: function () { return Promise.resolve({ ok: false }); },
        readNow: function () { return Promise.resolve({ ok: false }); },
        clear: function () { return Promise.resolve({ ok: false }); },
        remove: function () { return Promise.resolve({ ok: false }); },
        writeText: function () { return Promise.resolve({ ok: false }); }
      },
      capture: {
        selection: function () { return Promise.resolve({ ok: false }); },
        shot: function () { return Promise.resolve({ ok: false }); }
      },
      ai: {
        send: function () { return Promise.resolve({ ok: false }); },
        abort: function () { return Promise.resolve({ ok: false }); },
        test: function () { return Promise.resolve({ ok: false }); },
        onContext: function () { return function () { }; },
        onDelta: function () { return function () { }; },
        onDone: function () { return function () { }; },
        onError: function () { return function () { }; }
      },
      data: {
        export: function () { return Promise.resolve({ ok: false }); },
        import: function () { return Promise.resolve({ ok: false }); },
        reset: function () { return Promise.resolve({ ok: false }); }
      },
      pet: {
        pickAssets: function () { return Promise.resolve({ ok: false }); },
        create: function () { return Promise.resolve({ ok: false }); },
        remove: function () { return Promise.resolve({ ok: false }); },
        update: function () { return Promise.resolve({ ok: false }); },
        test: function () { return Promise.resolve({ ok: false }); },
        pointerDown: function () { return Promise.resolve({ ok: false }); },
        pointerUp: function () { return Promise.resolve({ ok: false }); },
        resize: function () { return Promise.resolve({ ok: false }); },
        played: function () { },
        onInit: function () { return function () { }; },
        onPaused: function () { return function () { }; },
        onSpeak: function () { return function () { }; },
        onStop: function () { return function () { }; },
        onSize: function () { return function () { }; }
      },
      shot: {
        onImage: function () { return function () { }; },
        confirm: function () { },
        cancel: function () { }
      },
      app: { info: function () { return Promise.resolve({}); } }
    };
    window.platform = platform;
  }

  var view = (platform.env && platform.env.view) || 'panel';
  document.documentElement.dataset.view = view;

  window.TB = window.TB || {};
  window.TB.platform = platform;
  window.TB.view = view;
})();
