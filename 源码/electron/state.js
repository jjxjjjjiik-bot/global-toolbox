'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { defaultState } = require('./seed');

const SRC_DIR = path.join(__dirname, '..', 'src');

let userDataDir = '';
let dataFile = '';
let aiConnectionFile = '';
let mediaDir = '';
let tmpDir = '';

function init(dir) {
  userDataDir = dir;
  dataFile = path.join(dir, 'data.json');
  aiConnectionFile = path.join(dir, 'ai-connection.local.json');
  mediaDir = path.join(dir, 'media');
  tmpDir = path.join(dir, 'tmp');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  cleanTmp();
}

function cleanTmp() {
  try {
    for (const name of fs.readdirSync(tmpDir)) {
      if (name.startsWith('shot-')) {
        try { fs.unlinkSync(path.join(tmpDir, name)); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}

function uid(prefix) {
  return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeItem(item, fallbackGroup) {
  return {
    id: String(item.id || uid('n')),
    type: item.type === 'image' ? 'image' : 'text',
    title: String(item.title || ''),
    content: String(item.content || ''),
    image: String(item.image || ''),
    groupId: String(item.groupId || fallbackGroup),
    useCount: Number(item.useCount) || 0,
    createdAt: Number(item.createdAt) || Date.now(),
    lastUsedAt: Number(item.lastUsedAt) || 0
  };
}

function normalizeClipEntry(entry) {
  const type = entry.type === 'image' ? 'image' : 'text';
  return {
    id: String(entry.id || uid('c')),
    type: type,
    content: type === 'text' ? String(entry.content || '').slice(0, 20000) : '',
    image: type === 'image' ? String(entry.image || '') : '',
    source: String(entry.source || '导入'),
    sig: String(entry.sig || ''),
    createdAt: Number(entry.createdAt) || Date.now()
  };
}

function normalizePet(pet, index) {
  const clips = Array.isArray(pet.clips) ? pet.clips.map(function (clip) {
    return {
      id: Number(clip.id) || 0,
      label: String(clip.label || ''),
      file: String(clip.file || ''),
      duration: Number(clip.duration) || 0,
      enabled: clip.enabled !== false
    };
  }).filter(function (clip) { return clip.id > 0 && clip.label && clip.file; }) : [];

  return {
    id: String(pet.id || uid('pet')),
    name: String(pet.name || '未命名桌宠'),
    tag: String(pet.tag || ''),
    builtin: !!pet.builtin,
    avatar: String(pet.avatar || ''),
    clips: clips,
    enabled: pet.enabled !== false,
    paused: !!pet.paused,
    size: Math.min(420, Math.max(120, Number(pet.size) || 196)),
    x: pet.x == null || pet.x === '' ? null : (Number.isFinite(Number(pet.x)) ? Number(pet.x) : null),
    y: pet.y == null || pet.y === '' ? null : (Number.isFinite(Number(pet.y)) ? Number(pet.y) : null),
    order: Number.isFinite(Number(pet.order)) ? Number(pet.order) : index
  };
}

function normalizeStep(step) {
  return {
    petId: String(step.petId || ''),
    mode: step.mode === 'fixed' ? 'fixed' : 'random',
    clipId: step.clipId == null ? null : Number(step.clipId),
    delayMs: Math.min(60000, Math.max(0, Number(step.delayMs) || 0))
  };
}

function normalizeReplyScene(scene, index) {
  const steps = Array.isArray(scene && scene.steps)
    ? scene.steps.map(normalizeStep).filter(function (step) { return !!step.petId; })
    : [];
  return {
    id: String((scene && scene.id) || uid('scene')),
    name: String((scene && scene.name) || '接话 ' + (index + 1)).trim().slice(0, 60) || ('接话 ' + (index + 1)),
    enabled: !scene || scene.enabled !== false,
    steps: steps
  };
}

/* 旧版把“接话顺序”按触发桌宠存在 replyRules，把单套小剧场存在 theater。
   新版统一成可启用的多套 replyScenes；旧接话把触发桌宠补成第一句。 */
function migrateLegacyScenes(saved, pets) {
  const names = {};
  (pets || []).forEach(function (pet) { names[pet.id] = pet.name; });
  const scenes = [];
  const signatures = new Set();
  const rules = saved.replyRules && typeof saved.replyRules === 'object' ? saved.replyRules : {};

  function addScene(scene) {
    const signature = scene.steps.map(function (step) {
      return [step.petId, step.mode, step.clipId == null ? '' : step.clipId, step.delayMs].join(':');
    }).join('|');
    if (signatures.has(signature)) return;
    signatures.add(signature);
    scenes.push(scene);
  }

  Object.keys(rules).forEach(function (petId) {
    const steps = Array.isArray(rules[petId]) ? rules[petId].map(normalizeStep).filter(function (step) {
      return !!step.petId;
    }) : [];
    if (!petId || !steps.length) return;
    addScene({
      id: 'scene-legacy-rule-' + petId,
      name: (names[petId] || '桌宠') + '开场',
      enabled: true,
      steps: [{ petId: petId, mode: 'random', clipId: null, delayMs: 0 }].concat(steps)
    });
  });

  const theaterSteps = saved.theater && Array.isArray(saved.theater.steps)
    ? saved.theater.steps.map(normalizeStep).filter(function (step) { return !!step.petId; })
    : [];
  if (theaterSteps.length) {
    addScene({
      id: 'scene-legacy-theater',
      name: '小剧场',
      enabled: true,
      steps: theaterSteps
    });
  }
  return scenes;
}

function selectReplyScene(scenes, petId, random) {
  const pool = (Array.isArray(scenes) ? scenes : []).filter(function (scene) {
    return scene && scene.enabled !== false && Array.isArray(scene.steps) &&
      scene.steps.length && scene.steps[0].petId === petId;
  });
  if (!pool.length) return null;
  const roll = typeof random === 'function' ? Number(random()) : Math.random();
  const safeRoll = Number.isFinite(roll) ? Math.min(0.999999, Math.max(0, roll)) : 0;
  return pool[Math.floor(safeRoll * pool.length)];
}

function normalize(state) {
  const base = defaultState();
  const saved = state && typeof state === 'object' ? state : {};
  const settings = Object.assign({}, base.settings, saved.settings || {}, {
    hotkeys: Object.assign({}, base.settings.hotkeys, (saved.settings || {}).hotkeys || {}),
    ai: Object.assign({}, base.settings.ai, (saved.settings || {}).ai || {})
  });

  const groups = Array.isArray(saved.groups) && saved.groups.length
    ? saved.groups.map(function (group) {
        return { id: String(group.id || uid('g')), name: String(group.name || '未命名分组') };
      })
    : base.groups;

  const fallbackGroup = groups[0] ? groups[0].id : 'reply';
  const items = Array.isArray(saved.items)
    ? saved.items.map(function (item) { return normalizeItem(item, fallbackGroup); })
    : base.items;

  function presets(list, fallback) {
    const seen = new Set();
    return (Array.isArray(list) ? list : fallback).filter(function (item) {
      if (!item || !String(item.name || '').trim() || !String(item.text || '').trim()) return false;
      if (seen.has(String(item.id))) return false;
      seen.add(String(item.id));
      return true;
    }).map(function (item) {
      return { id: String(item.id || uid('preset')), name: String(item.name).trim().slice(0, 60), text: String(item.text).trim().slice(0, 20000) };
    });
  }
  const personas = presets(saved.personas, base.personas);
  const prompts = presets(saved.prompts, base.prompts);
  if (settings.personaId && !personas.some(item => item.id === settings.personaId)) settings.personaId = personas[0] ? personas[0].id : '';
  if (settings.promptId && !prompts.some(item => item.id === settings.promptId)) settings.promptId = prompts[0] ? prompts[0].id : '';

  const pets = Array.isArray(saved.pets) && saved.pets.length
    ? saved.pets.map(normalizePet)
    : base.pets;

  /* 一次性迁移：内置桌宠的录音全部放开，不再沿用原项目的 defaultOff */
  if (settings.clipsAllEnabled !== true) {
    pets.forEach(function (pet) {
      (pet.clips || []).forEach(function (clip) { clip.enabled = true; });
    });
    settings.clipsAllEnabled = true;
  }

  let replyScenes;
  if (Array.isArray(saved.replyScenes)) {
    replyScenes = saved.replyScenes.map(normalizeReplyScene).filter(function (scene) {
      return !!scene.steps.length;
    });
  } else if (
    (saved.replyRules && typeof saved.replyRules === 'object') ||
    (saved.theater && typeof saved.theater === 'object')
  ) {
    replyScenes = migrateLegacyScenes(saved, pets).map(normalizeReplyScene);
  } else {
    replyScenes = base.replyScenes.map(normalizeReplyScene);
  }

  if (['light', 'dark', 'auto'].indexOf(settings.theme) < 0) settings.theme = 'light';
  if (typeof settings.clipPin !== 'boolean') settings.clipPin = false;
  if (settings.panelSize !== 'custom' && !{ compact: 1, standard: 1, large: 1 }[settings.panelSize]) {
    settings.panelSize = 'standard';
  }
  settings.panelW = Math.min(1120, Math.max(480, Number(settings.panelW) || 700));
  settings.panelH = Math.min(920, Math.max(420, Number(settings.panelH) || 590));
  settings.ai.userContext = String(settings.ai.userContext || '').slice(0, 8000);
  if (settings.panelSize !== 'custom') {
    const sizes = { compact: [560, 500], standard: [700, 590], large: [840, 680] };
    const pair = sizes[settings.panelSize] || sizes.standard;
    settings.panelW = pair[0];
    settings.panelH = pair[1];
  }

  const clipboard = Array.isArray(saved.clipboard)
    ? saved.clipboard.map(normalizeClipEntry).slice(0, 40)
    : [];

  return {
    version: 3,
    groups: groups,
    items: items,
    settings: settings,
    clipboard: clipboard,
    personas: personas.map(function (p) {
      return { id: String(p.id || uid('p')), name: String(p.name || '未命名'), text: String(p.text || '') };
    }),
    prompts: prompts.map(function (p) {
      return { id: String(p.id || uid('p')), name: String(p.name || '未命名'), text: String(p.text || '') };
    }),
    pets: pets,
    replyScenes: replyScenes
  };
}

function applyLocalAIConnection(state) {
  try {
    if (fs.existsSync(aiConnectionFile)) {
      const connection = JSON.parse(fs.readFileSync(aiConnectionFile, 'utf8'));
      if (connection && typeof connection.baseUrl === 'string' && typeof connection.model === 'string') {
        state.settings.ai = Object.assign({}, state.settings.ai, connection);
      }
    }
  } catch (err) { console.error('读取 AI 连接配置失败：', err.message); }
  return state;
}

function load() {
  try {
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf8');
      return applyLocalAIConnection(normalize(JSON.parse(raw)));
    }
  } catch (err) {
    console.error('读取数据失败，使用默认数据：', err.message);
    try { fs.copyFileSync(dataFile, dataFile + '.broken-' + Date.now()); } catch (e) { /* ignore */ }
  }
  return applyLocalAIConnection(defaultState());
}

let saveTimer = null;
let queued = null;

function saveNow(state) {
  const disk = stripClientFields(state);
  const aiTmp = aiConnectionFile + '.tmp';
  fs.writeFileSync(aiTmp, JSON.stringify(disk.settings.ai, null, 2), 'utf8');
  fs.renameSync(aiTmp, aiConnectionFile);
  disk.settings.ai.apiKey = '';
  const json = JSON.stringify(disk, null, 2);
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dataFile);
}

function save(state) {
  // 简单防抖，避免拖动/输入时高频写盘
  queued = state;
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    const target = queued;
    queued = null;
    try { saveNow(target); } catch (err) { console.error('保存数据失败：', err.message); }
  }, 180);
}

function flush(state) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const target = state || queued;
  queued = null;
  if (target) {
    try { saveNow(target); } catch (err) { console.error('保存数据失败：', err.message); }
  }
}

/* ==================== 媒体文件 ==================== */
function refToUrl(ref) {
  const value = String(ref || '');
  if (!value) return '';
  if (/^(data:|https?:|file:)/i.test(value)) return value;
  if (value.indexOf('assets/') === 0) return value;
  if (value.indexOf('media/') === 0) {
    return pathToFileURL(path.join(userDataDir, value)).href;
  }
  return '';
}

function resolveRef(ref) {
  const value = String(ref || '');
  if (!value) return '';
  if (value.indexOf('assets/') === 0) return path.join(SRC_DIR, value);
  if (value.indexOf('media/') === 0) return path.join(userDataDir, value);
  return '';
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function saveImageDataUrl(dataUrl, relDir, baseName) {
  const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const rel = relDir + '/' + baseName + '.' + ext;
  const file = path.join(userDataDir, rel);
  ensureParent(file);
  fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
  return rel;
}

function saveImageBuffer(buffer, relDir, baseName) {
  const rel = relDir + '/' + baseName + '.png';
  const file = path.join(userDataDir, rel);
  ensureParent(file);
  fs.writeFileSync(file, buffer);
  return rel;
}

function readRefAsBuffer(ref) {
  const file = resolveRef(ref);
  if (!file || !fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

function readRefAsDataUrl(ref) {
  const value = String(ref || '');
  if (/^data:/i.test(value)) return value;
  const file = resolveRef(value);
  if (!file || !fs.existsSync(file)) return '';
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
  return 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
}

function deleteRef(ref) {
  const value = String(ref || '');
  if (value.indexOf('media/') !== 0) return;
  const file = resolveRef(value);
  if (!file) return;
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { /* ignore */ }
}

/* ==================== 渲染端状态 ==================== */
function toClient(state) {
  const out = clone(state);
  out.items = out.items.map(function (item) {
    return Object.assign({}, item, { imageUrl: refToUrl(item.image) });
  });
  out.clipboard = out.clipboard.map(function (entry) {
    return Object.assign({}, entry, { imageUrl: refToUrl(entry.image) });
  });
  out.pets = out.pets.map(function (pet) {
    return Object.assign({}, pet, {
      avatarUrl: refToUrl(pet.avatar),
      clips: pet.clips.map(function (clip) {
        return Object.assign({}, clip, { url: refToUrl(clip.file) });
      })
    });
  });
  return out;
}

function stripClientFields(state) {
  const out = clone(state);
  delete out.clipboardMeta;
  if (Array.isArray(out.items)) {
    out.items.forEach(function (item) {
      delete item.imageUrl;
    });
  }
  if (Array.isArray(out.clipboard)) {
    out.clipboard.forEach(function (entry) {
      delete entry.imageUrl;
    });
  }
  if (Array.isArray(out.pets)) {
    out.pets.forEach(function (pet) {
      delete pet.avatarUrl;
      if (Array.isArray(pet.clips)) {
        pet.clips.forEach(function (clip) {
          delete clip.url;
        });
      }
    });
  }
  return out;
}

/* ==================== 导入导出 ==================== */
function exportState(state) {
  const out = stripClientFields(state);
  out.settings.ai.apiKey = '';
  out.items = out.items.map(function (item) {
    const copy = Object.assign({}, item);
    if (copy.image && copy.image.indexOf('media/') === 0) {
      copy.image = readRefAsDataUrl(copy.image) || '';
    }
    return copy;
  });
  out.clipboard = out.clipboard.map(function (entry) {
    const copy = Object.assign({}, entry);
    if (copy.image && copy.image.indexOf('media/') === 0) {
      copy.image = readRefAsDataUrl(copy.image) || '';
    }
    return copy;
  });
  out.meta = { app: '全局工具箱', version: 3, exportedAt: new Date().toISOString() };
  return out;
}

function importState(raw, current) {
  const normalized = normalize(raw);
  normalized.settings.ai.apiKey = current.settings.ai.apiKey;
  normalized.clipboard = [];
  normalized.items = normalized.items.map(function (item) {
    if (item.image && /^data:image\//i.test(item.image)) {
      const rel = saveImageDataUrl(item.image, 'media/items', uid('import'));
      if (rel) item.image = rel;
    }
    return item;
  });
  return normalized;
}

module.exports = {
  init,
  load,
  save,
  flush,
  normalize,
  selectReplyScene,
  toClient,
  stripClientFields,
  exportState,
  importState,
  refToUrl,
  resolveRef,
  saveImageDataUrl,
  saveImageBuffer,
  readRefAsBuffer,
  readRefAsDataUrl,
  deleteRef,
  uid,
  get userDataDir() { return userDataDir; },
  get mediaDir() { return mediaDir; },
  get tmpDir() { return tmpDir; },
  get dataFile() { return dataFile; },
  get srcDir() { return SRC_DIR; }
};
