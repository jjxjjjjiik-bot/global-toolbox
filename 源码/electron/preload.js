'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = function (event, payload) {
    try { callback(payload); } catch (err) { console.error(err); }
  };
  ipcRenderer.on(channel, handler);
  return function () { ipcRenderer.removeListener(channel, handler); };
}

const params = new URLSearchParams(window.location.search);
const pathname = String(window.location.pathname || '').replace(/\\/g, '/');
let view = params.get('view') || '';
if (!view) {
  if (pathname.indexOf('shot.html') >= 0) view = 'shot';
  else if (pathname.indexOf('pet.html') >= 0) view = 'pet';
  else view = 'panel';
}

contextBridge.exposeInMainWorld('platform', {
  env: {
    view: view,
    petId: params.get('pet') || '',
    displayId: params.get('id') || '',
    platform: process.platform,
    electron: process.versions.electron
  },

  state: {
    get: function () { return ipcRenderer.invoke('state:get'); },
    getSync: function () {
      try { return ipcRenderer.sendSync('state:get-sync'); } catch (err) { return null; }
    },
    set: function (state) { return ipcRenderer.invoke('state:set', state); },
    onChanged: function (callback) { return subscribe('state:changed', callback); }
  },

  nav: {
    open: function (name, payload) { return ipcRenderer.invoke('nav:open', name, payload); },
    back: function (viewName) { return ipcRenderer.invoke('nav:back', viewName); },
    openSettings: function (section) { return ipcRenderer.invoke('nav:open-settings', section || ''); },
    closeAI: function () { return ipcRenderer.invoke('nav:close-ai'); },
    onSettings: function (callback) { return subscribe('nav:settings', callback); }
  },

  window: {
    hide: function (viewName, showTip) {
      return ipcRenderer.invoke('window:hide', { view: viewName, showTip: !!showTip });
    },
    quit: function () { return ipcRenderer.invoke('window:quit'); },
    setPin: function (pin) { return ipcRenderer.invoke('window:set-pin', pin); },
    dragStart: function (x, y) { ipcRenderer.send('window:drag-start', { x: x, y: y }); },
    dragMove: function (x, y) { ipcRenderer.send('window:drag-move', { x: x, y: y }); },
    dragEnd: function () { ipcRenderer.send('window:drag-end'); },
    setClipPin: function (pin) { return ipcRenderer.invoke('window:set-clip-pin', pin); },
    resizePanel: function (w, h, x, y) { return ipcRenderer.invoke('window:resize-panel', { w: w, h: h, x: x, y: y }); },
    resizePanelLive: function (w, h, x, y) { ipcRenderer.send('window:resize-panel-live', { w: w, h: h, x: x, y: y }); },
    resizeWindow: function (w, h, x, y) { return ipcRenderer.invoke('window:resize-view', { w: w, h: h, x: x, y: y }); },
    resizeWindowLive: function (w, h, x, y) { ipcRenderer.send('window:resize-view-live', { w: w, h: h, x: x, y: y }); },
    setPanelSize: function (value) { return ipcRenderer.invoke('window:set-panel-size', { value: value }); },
    onPanelSize: function (callback) { return subscribe('panel:size-changed', callback); }
  },

  snippet: {
    activate: function (id) { return ipcRenderer.invoke('snippet:activate', id); },
    copy: function (id) { return ipcRenderer.invoke('snippet:copy', id); }
  },

  media: {
    saveImage: function (dataUrl, id) { return ipcRenderer.invoke('media:save-image', { dataUrl: dataUrl, id: id }); }
  },

  clipboard: {
    copy: function (id) { return ipcRenderer.invoke('clipboard:copy', id); },
    paste: function (id) { return ipcRenderer.invoke('clipboard:paste', id); },
    readNow: function () { return ipcRenderer.invoke('clipboard:read-now'); },
    clear: function () { return ipcRenderer.invoke('clipboard:clear'); },
    remove: function (id) { return ipcRenderer.invoke('clipboard:remove', id); },
    writeText: function (text) { return ipcRenderer.invoke('clipboard:write-text', text); }
  },

  capture: {
    selection: function () { return ipcRenderer.invoke('capture:selection'); },
    shot: function () { return ipcRenderer.invoke('capture:shot'); }
  },

  ai: {
    send: function (payload) { return ipcRenderer.invoke('ai:send', payload); },
    abort: function (requestId) { return ipcRenderer.invoke('ai:abort', requestId); },
    test: function (config) { return ipcRenderer.invoke('ai:test', config); },
    models: function (config) { return ipcRenderer.invoke('ai:models', config); },
    onContext: function (callback) { return subscribe('ai:context', callback); },
    onDelta: function (callback) { return subscribe('ai:delta', callback); },
    onDone: function (callback) { return subscribe('ai:done', callback); },
    onError: function (callback) { return subscribe('ai:error', callback); }
  },

  data: {
    export: function () { return ipcRenderer.invoke('data:export'); },
    import: function () { return ipcRenderer.invoke('data:import'); },
    reset: function () { return ipcRenderer.invoke('data:reset'); }
  },

  pet: {
    pickAssets: function (kind) { return ipcRenderer.invoke('pet:pick-assets', kind); },
    create: function (payload) { return ipcRenderer.invoke('pet:create', payload); },
    remove: function (id) { return ipcRenderer.invoke('pet:delete', id); },
    update: function (payload) { return ipcRenderer.invoke('pet:update', payload); },
    test: function (id) { return ipcRenderer.invoke('pet:test', id); },
    pointerDown: function (id) { return ipcRenderer.invoke('pet:click', id); },
    pointerUp: function (id) { return ipcRenderer.invoke('pet:pointer-up', id); },
    resize: function (id, delta) { return ipcRenderer.invoke('pet:resize', { id: id, delta: delta }); },
    played: function (payload) { ipcRenderer.send('pet:played', payload); },
    onInit: function (callback) { return subscribe('pet:init', callback); },
    onPaused: function (callback) { return subscribe('pet:paused', callback); },
    onSpeak: function (callback) { return subscribe('pet:speak', callback); },
    onStop: function (callback) { return subscribe('pet:stop', callback); },
    onSize: function (callback) { return subscribe('pet:size', callback); }
  },

  shot: {
    onImage: function (callback) { return subscribe('shot:image', callback); },
    confirm: function (payload) { ipcRenderer.send('shot:confirm', payload); },
    cancel: function () { ipcRenderer.send('shot:cancel'); }
  },

  app: {
    info: function () { return ipcRenderer.invoke('app:info'); }
  }
});
