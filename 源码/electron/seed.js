'use strict';

const fs = require('fs');
const path = require('path');

const ASSET_ROOT = path.join(__dirname, '..', 'src', 'assets');

/* ==================== 演示图片 ==================== */
function svgData(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function makeQrImage() {
  const n = 25, cell = 12, pad = 10, size = n * cell + pad * 2;
  let cells = '';
  function isFinder(x, y) {
    return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  }
  function finderOn(x, y) {
    const lx = x >= n - 7 ? x - (n - 7) : x;
    const ly = y >= n - 7 ? y - (n - 7) : y;
    return lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let on;
      if (isFinder(x, y)) on = finderOn(x, y);
      else if (x >= 9 && x <= 15 && y >= 9 && y <= 15) on = false;
      else on = ((x * 17 + y * 29 + x * y * 3 + x * x + y * y) % 11) < 5;
      if (on) {
        cells += '<rect x="' + (pad + x * cell) + '" y="' + (pad + y * cell) + '" width="' + cell + '" height="' + cell + '" rx="2.5" fill="#1b2430"/>';
      }
    }
  }
  const c = size / 2;
  return svgData('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<rect width="100%" height="100%" fill="#fbfcff"/>' +
    '<rect x="4" y="4" width="' + (size - 8) + '" height="' + (size - 8) + '" rx="30" fill="#ffffff"/>' +
    cells +
    '<rect x="' + (c - 27) + '" y="' + (c - 27) + '" width="54" height="54" rx="15" fill="#ffffff"/>' +
    '<rect x="' + (c - 18) + '" y="' + (c - 18) + '" width="36" height="36" rx="10" fill="#0a6fe0"/>' +
    '<path d="M' + (c - 9) + ' ' + (c - 1) + ' l6 6 12-13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>');
}

function makeQuoteImage() {
  const w = 360, h = 240;
  let lines = '';
  [292, 250, 280, 208].forEach(function (width, i) {
    lines += '<rect x="34" y="' + (102 + i * 18) + '" width="' + width + '" height="6" rx="3" fill="#dbe5f2"/>';
  });
  return svgData('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#eef4fc"/><stop offset="1" stop-color="#dbe7f7"/></linearGradient></defs>' +
    '<rect width="' + w + '" height="' + h + '" fill="url(#bg)"/>' +
    '<rect x="18" y="14" width="324" height="212" rx="12" fill="#ffffff" stroke="#dbe5f2"/>' +
    '<rect x="34" y="32" width="92" height="10" rx="5" fill="#1b2430" opacity=".85"/>' +
    '<rect x="34" y="52" width="156" height="6" rx="3" fill="#b9c6d8"/>' +
    '<rect x="34" y="76" width="292" height="1" fill="#e8eef6"/>' +
    lines +
    '<rect x="34" y="178" width="292" height="30" rx="9" fill="#eaf1fb"/>' +
    '<rect x="34" y="178" width="84" height="30" rx="9" fill="#0a6fe0" opacity=".16"/>' +
    '<text x="46" y="198" font-family="Segoe UI, sans-serif" font-size="12" fill="#35506f">报价单 · 2026-11</text>' +
    '<text x="236" y="198" font-family="Segoe UI, sans-serif" font-size="12" font-weight="600" fill="#0a6fe0">¥ 12,800</text>' +
    '</svg>');
}

/* ==================== 内置桌宠 ==================== */
function buildBuiltinPets() {
  const defs = [
    { id: 'sun', name: '孙宇晨', tag: '太对了', dir: 'sun', size: 196 },
    { id: 'feng', name: '峰哥', tag: '好事', dir: 'feng', size: 204 },
    { id: 'shaolan', name: '邵艾伦', tag: '薄肌', dir: 'shaolan', size: 196 }
  ];

  return defs.map(function (def) {
    let raw = [];
    try {
      raw = JSON.parse(fs.readFileSync(path.join(ASSET_ROOT, 'pets', def.dir, 'clips.json'), 'utf8'));
    } catch (err) {
      console.error('读取桌宠台词失败：', def.dir, err.message);
    }
    const clips = raw.map(function (clip) {
      return {
        id: Number(clip.id),
        label: String(clip.label || ''),
        file: 'assets/pets/' + def.dir + '/clips/' + String(clip.file || '').replace(/\.m4a$/i, '.wav'),
        duration: Number(clip.duration) || 0,
        /* 内置素材默认全部可用，不再按原项目的 defaultOff 关掉一部分 */
        enabled: true
      };
    }).filter(function (clip) { return clip.id > 0 && clip.label && clip.file; });

    return {
      id: def.id,
      name: def.name,
      tag: def.tag,
      builtin: true,
      avatar: 'assets/pets/' + def.dir + '/face.png',
      clips: clips,
      enabled: true,
      paused: false,
      size: def.size,
      x: null,
      y: null
    };
  });
}

/* ==================== 默认状态 ==================== */
function defaultState() {
  return {
    version: 3,
    groups: [
      { id: 'reply', name: '常用话术' },
      { id: 'work', name: '工作回复' },
      { id: 'prompt', name: 'Prompt' },
      { id: 'addr', name: '地址' },
      { id: 'img', name: '图片' }
    ],
    items: [],
    settings: {
      theme: 'light',
      panelSize: 'standard',
      panelW: 700,
      panelH: 590,
      hotkeys: {
        panel: 'Ctrl+Shift+Space',
        select: 'Alt+Q',
        shot: 'Alt+S',
        clipboard: 'Alt+V',
        paste: 'Enter',
        search: '/',
        up: 'ArrowUp',
        down: 'ArrowDown'
      },
      closeToTray: true,
      pin: false,
      clipPin: false,
      recordUsage: true,
      clipboardWatch: true,
      ai: { baseUrl: '', apiKey: '', model: '', connection: null, userContext: '' },
      personaId: 'general',
      promptId: 'direct',
      petEnabled: false,
      petPaused: false
    },
    clipboard: [],
    personas: [
      { id: 'general', name: '通用助手', text: '你是一个可靠、直接的中文助手。先给结论，再给必要的依据，不写空话。' },
      { id: 'translator', name: '翻译官', text: '你是专业翻译。默认在中英文之间互译，保留原文语气，专有名词给出对照。' },
      { id: 'editor', name: '文案编辑', text: '你是中文文案编辑。删掉空话和重复，让表达自然、具体、有分寸。' },
      { id: 'product', name: '产品顾问', text: '你是资深产品经理。先澄清目标和约束，再给可执行的建议，并标注风险。' }
    ],
    prompts: [
      { id: 'direct', name: '直接提问', text: '直接回答用户的问题；有选中文字或截图时结合上下文。没有依据的信息请明确说明。' },
      { id: 'explain', name: '解释这段话', text: '解释选中内容的含义、上下文和潜在意图，用三点说清楚。' },
      { id: 'translate', name: '翻译成英文', text: '把选中内容翻译成自然的英文，保留语气。' },
      { id: 'polish', name: '润色一下', text: '在不改变原意的前提下润色，让表达更自然、礼貌、简洁。' },
      { id: 'summary', name: '总结要点', text: '提取关键信息，用短条目列出时间、事项、要求。' },
      { id: 'reply', name: '帮我回复', text: '根据上下文起草一条得体的回复，语气专业、不卑不亢。' }
    ],
    pets: buildBuiltinPets(),
    replyScenes: [
      {
        id: 'scene-feng',
        name: '峰哥开场',
        enabled: true,
        steps: [
          { petId: 'feng', mode: 'random', clipId: null, delayMs: 0 },
          { petId: 'sun', mode: 'random', clipId: null, delayMs: 350 }
        ]
      },
      {
        id: 'scene-shaolan',
        name: '邵艾伦开场',
        enabled: true,
        steps: [
          { petId: 'shaolan', mode: 'random', clipId: null, delayMs: 0 },
          { petId: 'sun', mode: 'random', clipId: null, delayMs: 280 },
          { petId: 'feng', mode: 'random', clipId: null, delayMs: 280 },
          { petId: 'sun', mode: 'random', clipId: null, delayMs: 280 }
        ]
      }
    ]
  };
}

module.exports = { defaultState, buildBuiltinPets, ASSET_ROOT };
