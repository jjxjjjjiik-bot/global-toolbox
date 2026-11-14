(function () {
  'use strict';

  /* Electron 桥接：所有窗口共用主进程里的唯一一份状态 */
  var platform = window.platform || null;
  var VIEW = platform && platform.env ? platform.env.view : 'panel';
  /* 一次按住只允许一种窗口手势，直到松手/取消才解锁。 */
  var windowGesture = null;
  var beginPanelResize = null;

  /* ==================== 常量与工具 ==================== */
  const STORAGE_KEY = 'globalToolbox.v1';
  const SAMPLE_TEXT = '明天上午十点前把方案发我，重点说明预算和排期。';
  const SIZES = {
    compact: { w: 560, h: 500 },
    standard: { w: 700, h: 590 },
    large: { w: 840, h: 680 }
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function icon(name, cls) {
    return '<svg class="ic ' + (cls || '') + '"><use href="#i-' + name + '"></use></svg>';
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function uid(prefix) {
    return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function shorten(text, n) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function svgData(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  /* ==================== 演示图片 ==================== */
  function makeQrImage() {
    var n = 25, cell = 12, pad = 10, size = n * cell + pad * 2;
    var cells = '';
    function isFinder(x, y) {
      return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    }
    function finderOn(x, y) {
      var lx = x >= n - 7 ? x - (n - 7) : x;
      var ly = y >= n - 7 ? y - (n - 7) : y;
      return lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
    }
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var on;
        if (isFinder(x, y)) on = finderOn(x, y);
        else if (x >= 9 && x <= 15 && y >= 9 && y <= 15) on = false;
        else on = ((x * 17 + y * 29 + x * y * 3 + x * x + y * y) % 11) < 5;
        if (on) {
          cells += '<rect x="' + (pad + x * cell) + '" y="' + (pad + y * cell) + '" width="' + cell + '" height="' + cell + '" rx="2.5" fill="#1b2430"/>';
        }
      }
    }
    var c = size / 2;
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
    var w = 360, h = 240;
    var lines = '';
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

  var SEED_QR = makeQrImage();
  var SEED_QUOTE = makeQuoteImage();

  /* ==================== 默认数据 ==================== */
  function defaultState() {
    return {
      groups: [
        { id: 'reply', name: '常用话术' },
        { id: 'work', name: '工作回复' },
        { id: 'prompt', name: 'Prompt' },
        { id: 'addr', name: '地址' },
        { id: 'img', name: '图片' }
      ],
      items: [
        { id: 'it_reply_1', type: 'text', title: '收到，我马上看', content: '收到，我先看下，十分钟内给您答复。', groupId: 'reply', useCount: 42, createdAt: 1700000000001, lastUsedAt: 0 },
        { id: 'it_reply_2', type: 'text', title: '稍等，我确认一下', content: '我确认一下细节，稍后回复您。', groupId: 'reply', useCount: 31, createdAt: 1700000000002, lastUsedAt: 0 },
        { id: 'it_work_1', type: 'text', title: '明天上午发您', content: '可以，我明天上午十点前整理好发您。', groupId: 'work', useCount: 18, createdAt: 1700000000003, lastUsedAt: 0 },
        { id: 'it_work_2', type: 'text', title: '周报模板', content: '本周完成：\n1. 需求梳理与排期\n2. 方案初稿\n3. 数据核对\n\n下周计划：\n1. 方案评审\n2. 开发联调\n\n风险与需要支持：暂无。', groupId: 'work', useCount: 21, createdAt: 1700000000004, lastUsedAt: 0 },
        { id: 'it_prompt_1', type: 'text', title: '需求澄清 Prompt', content: '你是一名资深产品经理。请把下面这段需求拆成：目标用户、核心场景、约束条件、可验证的验收标准。缺信息的地方先列假设，不要直接编。', groupId: 'prompt', useCount: 27, createdAt: 1700000000005, lastUsedAt: 0 },
        { id: 'it_prompt_2', type: 'text', title: '代码审查 Prompt', content: '请以资深工程师视角审查下面的代码：先指出会导致错误的问题，再谈可读性和性能。每个问题给出最小修改建议，不要重写整个文件。', groupId: 'prompt', useCount: 15, createdAt: 1700000000006, lastUsedAt: 0 },
        { id: 'it_addr_1', type: 'text', title: '学校地址', content: '江西省南昌市青山湖区双港东大街 808 号，华东交通大学。', groupId: 'addr', useCount: 9, createdAt: 1700000000007, lastUsedAt: 0 },
        { id: 'it_addr_2', type: 'text', title: '常用收货地址', content: '河南省洛阳市洛龙区开元大道 263 号。', groupId: 'addr', useCount: 6, createdAt: 1700000000008, lastUsedAt: 0 },
        { id: 'it_img_1', type: 'image', title: '微信二维码', content: '', image: SEED_QR, groupId: 'img', useCount: 12, createdAt: 1700000000009, lastUsedAt: 0 },
        { id: 'it_img_2', type: 'image', title: '报价单截图', content: '', image: SEED_QUOTE, groupId: 'img', useCount: 8, createdAt: 1700000000010, lastUsedAt: 0 }
      ],
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
        promptId: 'explain'
      },
      clipboard: [],
      personas: [
        { id: 'general', name: '通用助手', text: '你是一个可靠、直接的中文助手。先给结论，再给必要的依据，不写空话。' },
        { id: 'translator', name: '翻译官', text: '你是专业翻译。默认在中英文之间互译，保留原文语气，专有名词给出对照。' },
        { id: 'editor', name: '文案编辑', text: '你是中文文案编辑。删掉空话和重复，让表达自然、具体、有分寸。' },
        { id: 'product', name: '产品顾问', text: '你是资深产品经理。先澄清目标和约束，再给可执行的建议，并标注风险。' }
      ],
      prompts: [
        { id: 'explain', name: '解释这段话', text: '解释选中内容的含义、上下文和潜在意图，用三点说清楚。' },
        { id: 'translate', name: '翻译成英文', text: '把选中内容翻译成自然的英文，保留语气。' },
        { id: 'polish', name: '润色一下', text: '在不改变原意的前提下润色，让表达更自然、礼貌、简洁。' },
        { id: 'summary', name: '总结要点', text: '提取关键信息，用短条目列出时间、事项、要求。' },
        { id: 'reply', name: '帮我回复', text: '根据上下文起草一条得体的回复，语气专业、不卑不亢。' }
      ]
    };
  }

  function loadState() {
    var base = defaultState();
    var saved = null;
    try {
      if (platform && platform.state && platform.state.getSync) saved = platform.state.getSync();
    } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object') return base;
    var s = saved.settings || {};
    var ai = s.ai || {};
    return Object.assign({}, saved, {
      groups: Array.isArray(saved.groups) && saved.groups.length ? saved.groups : base.groups,
      items: Array.isArray(saved.items) ? saved.items : base.items,
      personas: Array.isArray(saved.personas) ? saved.personas : base.personas,
      prompts: Array.isArray(saved.prompts) ? saved.prompts : base.prompts,
      clipboard: Array.isArray(saved.clipboard) ? saved.clipboard : [],
      settings: Object.assign({}, base.settings, s, {
        hotkeys: Object.assign({}, base.settings.hotkeys, s.hotkeys || {}),
        ai: Object.assign({}, base.settings.ai, ai)
      })
    });
  }

  var state = loadState();
  var storageWarned = false;
  var saveQueued = false;

  function saveState() {
    if (!platform || !platform.state || !platform.state.set) return false;
    if (saveQueued) return true;
    saveQueued = true;
    Promise.resolve().then(function () {
      saveQueued = false;
      return platform.state.set(state);
    }).catch(function () {
      if (!storageWarned) {
        storageWarned = true;
        toast('保存失败，请检查磁盘权限或空间');
      }
    });
    return true;
  }

  /* 其他窗口改动数据后，主进程会广播；这里就地更新并重绘 */
  function adoptState(next) {
    if (!next || typeof next !== 'object') return;
    var previousPersona = getPersona();
    var previousPrompt = getPrompt();
    var previousPersonaId = previousPersona ? previousPersona.id : '';
    var previousPromptId = previousPrompt ? previousPrompt.id : '';
    Object.keys(state).forEach(function (key) { delete state[key]; });
    Object.assign(state, next);
    if (ui.recording) return;
    applyTheme(state.settings.theme, false);
    renderAll();
    renderAIChips();
    var nextPersona = getPersona();
    var nextPrompt = getPrompt();
    if (VIEW === 'aiDialog') {
      if ((nextPersona ? nextPersona.id : '') !== previousPersonaId) {
        updateAIComposerPreset('persona', previousPersona, nextPersona);
      }
      if ((nextPrompt ? nextPrompt.id : '') !== previousPromptId) {
        updateAIComposerPreset('prompt', previousPrompt, nextPrompt);
      }
    }
    syncAIComposerIfPristine();
    renderAIPageSummary();
    renderAIPrefsSettings();
    updateAIStatus();
    renderClipList();
    updateClipStatus();
    updatePinUI();
    if (VIEW === 'petSettings') renderPetSettings();
  }

  /* ==================== DOM ==================== */
  var el = {
    panel: $('#panel'),
    stage: $('#stage'),
    tabs: $('#tabs'),
    list: $('#list'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptyDesc: $('#emptyDesc'),
    emptyNewBtn: $('#emptyNewBtn'),
    searchBox: $('#searchBox'),
    searchInput: $('#searchInput'),
    searchEnter: $('#searchEnter'),
    searchClear: $('#searchClear'),
    themeBtn: $('#themeBtn'),
    menuBtn: $('#menuBtn'),
    settingsBtn: $('#settingsBtn'),
    pinBtn: $('#pinBtn'),
    hideBtn: $('#hideBtn'),
    closeBtn: $('#closeBtn'),
    newItemBtn: $('#newItemBtn'),

    settings: $('#settings'),
    settingsBody: $('#settingsBody'),
    aiSettingsGroup: $('#aiSettingsGroup'),
    settingsBack: $('#settingsBack'),
    settingsDone: $('#settingsDone'),
    aiBaseUrl: $('#aiBaseUrl'),
    aiApiKey: $('#aiApiKey'),
    aiModel: $('#aiModel'),
    apiKeyEye: $('#apiKeyEye'),
    testApiBtn: $('#testApiBtn'),
    managePresetsBtn: $('#managePresetsBtn'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importFile: $('#importFile'),
    resetBtn: $('#resetBtn'),

    aiPageSelect: $('#aiPageSelect'),
    aiPageShot: $('#aiPageShot'),
    aiPageSettings: $('#aiPageSettings'),
    aiHubUserContext: $('#aiHubUserContext'),
    aiPagePersona: $('#aiPagePersona'),
    aiPagePrompt: $('#aiPagePrompt'),
    aiPageModel: $('#aiPageModel'),
    aiPageSelectHotkey: $('#aiPageSelectHotkey'),
    aiPageShotHotkey: $('#aiPageShotHotkey'),

    launcherWindow: $('#launcherWindow'),
    launcherClose: $('#launcherClose'),
    launcherSettings: $('#launcherSettings'),
    launchPanelKbd: $('#launchPanelKbd'),
    launchAiKbd: $('#launchAiKbd'),
    launchClipKbd: $('#launchClipKbd'),
    aiHubWindow: $('#aiHubWindow'),
    aiPrefsWindow: $('#aiPrefsWindow'),
    aiUserContextInput: $('#aiUserContextInput'),
    aiPrefPromptList: $('#aiPrefPromptList'),
    aiPrefNewPrompt: $('#aiPrefNewPrompt'),
    aiPrefPromptEditor: $('#aiPrefPromptEditor'),
    aiPrefPromptEditorTitle: $('#aiPrefPromptEditorTitle'),
    aiPrefPromptName: $('#aiPrefPromptName'),
    aiPrefPromptText: $('#aiPrefPromptText'),
    aiPrefPromptCancel: $('#aiPrefPromptCancel'),
    petWindow: $('#petWindow'),

    clipWindow: $('#clipWindow'),
    clipBadge: $('#clipBadge'),
    clipPinBtn: $('#clipPinBtn'),
    clipStatusDot: $('#clipStatusDot'),
    clipStatusText: $('#clipStatusText'),
    clipReadBtn: $('#clipReadBtn'),
    clipClearBtn: $('#clipClearBtn'),
    clipList: $('#clipList'),
    clipEmpty: $('#clipEmpty'),
    clipViewer: $('#clipViewer'),
    clipViewerClose: $('#clipViewerClose'),
    clipViewerStage: $('#clipViewerStage'),
    clipViewerImg: $('#clipViewerImg'),
    clipViewerMeta: $('#clipViewerMeta'),
    clipViewerControls: $('#clipViewerControls'),
    clipViewerZoomOut: $('#clipViewerZoomOut'),
    clipViewerZoomIn: $('#clipViewerZoomIn'),
    clipViewerZoomFit: $('#clipViewerZoomFit'),
    clipViewerZoomLabel: $('#clipViewerZoomLabel'),
    clipViewerPaste: $('#clipViewerPaste'),
    clipViewerCopy: $('#clipViewerCopy'),

    footCount: $('#footCount'),
    resizeGrip: $('#resizeGrip'),
    panelSizeNow: $('#panelSizeNow'),

    rowMenu: $('#rowMenu'),
    trayMenu: $('#trayMenu'),
    trayBtn: $('#trayBtn'),
    trayPanelKbd: $('#trayPanelKbd'),

    entryLayer: $('#entryLayer'),
    entryTitle: $('#entryTitle'),
    entryTypeSeg: $('#entryTypeSeg'),
    entryTitleInput: $('#entryTitleInput'),
    entryTextWrap: $('#entryTextWrap'),
    entryImageWrap: $('#entryImageWrap'),
    entryContent: $('#entryContent'),
    dropzone: $('#dropzone'),
    entryFile: $('#entryFile'),
    entryPreview: $('#entryPreview'),
    entryGroup: $('#entryGroup'),
    entrySave: $('#entrySave'),

    groupLayer: $('#groupLayer'),
    groupTitle: $('#groupTitle'),
    groupNameInput: $('#groupNameInput'),
    groupSave: $('#groupSave'),

    presetLayer: $('#presetLayer'),
    personaList: $('#personaList'),
    promptList: $('#promptList'),
    personaAddInput: $('#personaAddInput'),
    promptAddInput: $('#promptAddInput'),

    confirmLayer: $('#confirmLayer'),
    confirmTitle: $('#confirmTitle'),
    confirmText: $('#confirmText'),
    confirmOk: $('#confirmOk'),
    confirmCancel: $('#confirmCancel'),

    aiWindow: $('#aiWindow'),
    aiDrag: $('#aiDrag'),
    aiCtxChip: $('#aiCtxChip'),
    aiSub: $('#aiSub'),
    aiCtxIcon: $('#aiCtxIcon'),
    aiCtxText: $('#aiCtxText'),
    aiCtxMeta: $('#aiCtxMeta'),
    aiExpand: $('#aiExpand'),
    aiCtxThumb: $('#aiCtxThumb'),
    personaChips: $('#personaChips'),
    promptChips: $('#promptChips'),
    personaCurrent: $('#personaCurrent'),
    promptCurrent: $('#promptCurrent'),
    aiQuestion: $('#aiQuestion'),
    aiModelChip: $('#aiModelChip'),
    aiSendBtn: $('#aiSendBtn'),
    aiSendHint: $('.ai-send-hint'),
    aiResult: $('#aiResult'),
    aiAnswer: $('#aiAnswer'),
    aiCopyBtn: $('#aiCopyBtn'),
    aiRetryBtn: $('#aiRetryBtn'),
    aiStatusText: $('#aiStatusText'),
    aiDot: $('#aiDot'),
    aiBody: $('#aiBody'),
    aiCloseBtn: $('#aiCloseBtn'),
    aiSettingsBtn: $('#aiSettingsBtn'),
    aiFootSettings: $('#aiFootSettings'),

    selectPill: $('#selectPill'),
    pillKbd: $('#pillKbd'),

    shotLayer: $('#shotLayer'),
    shotBox: $('#shotBox'),
    shotSize: $('#shotSize'),
    shotBar: $('#shotBar'),
    shotBarSize: $('#shotBarSize'),
    shotRetryBtn: $('#shotRetryBtn'),
    shotConfirmBtn: $('#shotConfirmBtn'),

    mockInput: $('#mockInput'),
    mockSend: $('#mockSend'),
    mockChat: $('#mockChat'),
    sampleBubble: $('#sampleBubble'),

    toast: $('#toast')
  };

  ['loadModelsBtn', 'aiModelOptions', 'aiConnectionFeedback', 'aiPageChat', 'aiHubQuestion', 'aiHubConnection', 'aiHubBadge',
    'presetEditor', 'presetEditorTitle', 'presetEditorCancel', 'presetEditorSave', 'presetName', 'presetText',
    'aiContext', 'aiContextClear', 'aiPresetPreview', 'aiEmpty', 'aiResultLabel', 'aiDialogSelect', 'aiDialogShot',
    'homeSnippetStatus', 'homeAIStatus', 'homeClipboardStatus', 'homePetStatus', 'homePetCount',
    'clipSearch', 'clipViewerText', 'clipViewerTitle'].forEach(function (id) { el[id] = document.getElementById(id); });

  /* Electron 版把启动器、截图、划词气泡、托盘拆成了独立窗口或原生能力；
     原型里对应的节点不存在时用离屏节点兜底，事件绑定不会因此中断 */
  Object.keys(el).forEach(function (key) {
    if (!el[key]) el[key] = document.createElement('div');
  });

  el.groupMenu = document.createElement('div');
  el.groupMenu.id = 'groupMenu';
  el.groupMenu.className = 'menu group-context-menu';
  document.body.appendChild(el.groupMenu);

  var ui = {
    activeGroup: 'all',
    query: '',
    pendingQuery: '',
    focusIndex: 0,
    viewItems: [],
    listScrollReset: false,
    scrollFocus: false,
    page: 'main',
    launcherOpen: false,
    entryEditingId: null,
    groupEditingId: null,
    entryType: 'text',
    entryImageData: '',
    recording: null,
    confirmResolve: null,
    aiContext: null,
    aiRestoreWindow: 'panel',
    aiFullText: '',
    aiStreamTimer: null,
    aiThinkingTimer: null,
    aiStreamNode: null,
    aiStreamIndex: 0,
    aiCustomKind: null,
    aiComposer: {
      personaId: '',
      promptId: '',
      lastValue: '',
      suppressAutoFill: false
    },
    aiLastRequest: null,
    aiDraftEditedAfterSend: false,
    pendingSelection: '',
    clipViewerId: null,
    clipViewerZoom: 1,
    shot: { active: false, dragging: false, start: null, rect: null, restoreWindow: 'panel' }
  };

  var toastTimer = null;
  function toast(message, isError) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.toggle('is-error', !!isError);
    var panelRect = el.panel.getBoundingClientRect();
    var footer = el.panel.querySelector('.panel-foot');
    var spaceBelow = innerHeight - panelRect.bottom;
    if (isPanelVisible() && spaceBelow < 64 && footer) {
      var footRect = footer.getBoundingClientRect();
      el.toast.style.bottom = Math.max(16, innerHeight - footRect.top + 12) + 'px';
    } else {
      el.toast.style.bottom = '38px';
    }
    el.toast.classList.add('is-show');
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('is-show');
    }, 2800);
  }

  /* ==================== 主题与尺寸 ==================== */
  var themeAnimTimer = null;
  function resolvedTheme(pref) {
    if (pref === 'auto') {
      return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return pref === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(pref, animate) {
    var current = document.documentElement.dataset.theme;
    var resolved = resolvedTheme(pref);
    if (animate && current !== resolved) {
      document.documentElement.classList.add('theme-anim');
      clearTimeout(themeAnimTimer);
      themeAnimTimer = setTimeout(function () {
        document.documentElement.classList.remove('theme-anim');
      }, 380);
    }
    document.documentElement.dataset.theme = resolved;
    $$('[data-seg="theme"] button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.value === pref);
    });
  }

  function setTheme(pref) {
    state.settings.theme = pref;
    saveState();
    applyTheme(pref, true);
  }

  function applyPanelSize(value) {
    var w, h;
    if (value === 'custom' && state.settings.panelW && state.settings.panelH) {
      w = state.settings.panelW;
      h = state.settings.panelH;
    } else {
      var size = SIZES[value] || SIZES.standard;
      w = size.w;
      h = size.h;
    }
    el.panel.style.setProperty('--panel-w', Math.round(w) + 'px');
    el.panel.style.setProperty('--panel-h', Math.round(h) + 'px');
    if (el.panelSizeNow) {
      el.panelSizeNow.textContent = ' 当前 ' + Math.round(w) + ' × ' + Math.round(h) + '。';
    }
    $$('[data-seg="size"] button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.value === value);
    });
  }

  function setPanelSize(value) {
    if (!SIZES[value]) value = 'standard';
    var size = SIZES[value];
    state.settings.panelSize = value;
    state.settings.panelW = size.w;
    state.settings.panelH = size.h;
    saveState();
    applyPanelSize(value);
    if (platform && platform.window) platform.window.setPanelSize(value);
  }

  function updatePinUI() {
    el.pinBtn.classList.toggle('is-on', !!state.settings.pin);
    if (el.clipPinBtn) el.clipPinBtn.classList.toggle('is-on', !!state.settings.clipPin);
  }

  /* ==================== 快捷键 ==================== */
  function renderHotkeyButtons() {
    $$('.hotkey-btn').forEach(function (btn) {
      var combo = state.settings.hotkeys[btn.dataset.hotkey] || '';
      btn.classList.remove('is-recording');
      if (combo) {
        btn.innerHTML = combo.split('+').map(function (part) {
          return '<kbd>' + esc(part) + '</kbd>';
        }).join('<span class="plus">+</span>');
      } else {
        btn.innerHTML = '<span class="plus">未设置</span>';
      }
    });
    refreshHotkeyDisplays();
  }

  function refreshHotkeyDisplays() {
    var select = state.settings.hotkeys.select || '未设置';
    var shot = state.settings.hotkeys.shot || '未设置';
    var panel = state.settings.hotkeys.panel || '未设置';
    var clipboard = state.settings.hotkeys.clipboard || '未设置';
    el.pillKbd.textContent = select;
    el.aiPageSelectHotkey.textContent = select;
    el.aiPageShotHotkey.textContent = shot;
    el.trayPanelKbd.textContent = panel;
    if (el.launchPanelKbd) el.launchPanelKbd.textContent = panel;
    if (el.launchAiKbd) el.launchAiKbd.textContent = select;
    if (el.launchClipKbd) el.launchClipKbd.textContent = clipboard;
  }

  function buildCombo(e, allowPlain) {
    var parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    var key = e.key;
    if (key === ' ' || key === 'Spacebar') key = 'Space';
    if (!key || key === 'Unidentified' || key === 'Dead') return '';
    if (key.length === 1) key = key.toUpperCase();
    if (!parts.length && !allowPlain && !/^F\d{1,2}$/.test(key)) {
      toast('全局快捷键至少加一个修饰键，或使用 F1–F12');
      return '';
    }
    return parts.concat(key).join('+');
  }

  function matchHotkey(e, combo) {
    if (!combo) return false;
    var parts = combo.split('+').map(function (p) { return p.trim().toLowerCase(); }).filter(Boolean);
    if (!parts.length) return false;
    var key = parts.pop();
    var needCtrl = parts.indexOf('ctrl') >= 0;
    var needAlt = parts.indexOf('alt') >= 0;
    var needShift = parts.indexOf('shift') >= 0;
    var needMeta = parts.indexOf('meta') >= 0;
    var pressed = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
    if (pressed === 'spacebar') pressed = 'space';
    var code = String(e.code || '').toLowerCase();
    return (pressed === key || code === key) &&
      e.ctrlKey === needCtrl && e.altKey === needAlt &&
      e.shiftKey === needShift && e.metaKey === needMeta;
  }

  function startRecording(btn, key) {
    if (ui.recording && ui.recording.key === key) { stopRecording(); return; }
    stopRecording();
    ui.recording = { key: key, btn: btn, handler: null };
    var allowPlain = ['panel', 'select', 'shot', 'clipboard'].indexOf(key) < 0;
    btn.classList.add('is-recording');
    btn.innerHTML = '<span class="rec-dot"></span>请按下组合键…';
    var handler = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stopRecording();
        renderHotkeyButtons();
        return;
      }
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
      var combo = buildCombo(e, allowPlain);
      if (!combo) return;
      state.settings.hotkeys[key] = combo;
      saveState();
      ui.recording = null;
      window.removeEventListener('keydown', handler, true);
      renderHotkeyButtons();
      toast('快捷键已更新为 ' + combo);
    };
    ui.recording.handler = handler;
    window.addEventListener('keydown', handler, true);
  }

  function stopRecording() {
    if (!ui.recording) return;
    if (ui.recording.handler) {
      window.removeEventListener('keydown', ui.recording.handler, true);
    }
    ui.recording = null;
    renderHotkeyButtons();
  }

  /* ==================== 列表渲染 ==================== */
  function computeView() {
    var q = ui.query.trim().toLowerCase();
    var items = state.items.filter(function (item) {
      return ui.activeGroup === 'all' || item.groupId === ui.activeGroup;
    });
    if (q) {
      items = items.filter(function (item) {
        var hay = (item.title || '') + ' ' + (item.type === 'text' ? item.content : '') + ' ' + (item.type === 'image' ? '图片' : '');
        return hay.toLowerCase().indexOf(q) >= 0;
      });
    }
    ui.viewItems = items;
    if (ui.focusIndex >= items.length) ui.focusIndex = Math.max(0, items.length - 1);
  }

  function highlight(text, q) {
    var source = String(text || '');
    if (!q) return esc(source);
    var idx = source.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return esc(source);
    return esc(source.slice(0, idx)) + '<mark>' + esc(source.slice(idx, idx + q.length)) + '</mark>' + esc(source.slice(idx + q.length));
  }

  function renderTabs() {
    var scrollLeft = el.tabs.scrollLeft;
    var html = '<button class="tab' + (ui.activeGroup === 'all' ? ' is-active' : '') + '" type="button" data-group="all">全部<span class="tab-n">' + state.items.length + '</span></button>';
    state.groups.forEach(function (group) {
      var count = state.items.filter(function (item) { return item.groupId === group.id; }).length;
      html += '<button class="tab' + (ui.activeGroup === group.id ? ' is-active' : '') + '" type="button" data-group="' + esc(group.id) + '" title="长按拖动排序 · 右键管理">' + esc(group.name) + '<span class="tab-n">' + count + '</span></button>';
    });
    html += '<button class="tab-add" id="addGroupBtn" type="button" title="新建分组" aria-label="新建分组">' + icon('plus') + '</button>';
    el.tabs.innerHTML = html;
    el.tabs.scrollLeft = scrollLeft;
    var active = el.tabs.querySelector('.tab.is-active');
    if (active) {
      var tabRect = active.getBoundingClientRect();
      var wrapRect = el.tabs.getBoundingClientRect();
      if (tabRect.left < wrapRect.left + 6) el.tabs.scrollLeft -= (wrapRect.left + 6 - tabRect.left);
      else if (tabRect.right > wrapRect.right - 6) el.tabs.scrollLeft += (tabRect.right - (wrapRect.right - 6));
    }
    renderFootCount();
  }

  function renderList() {
    computeView();
    var html = '';
    var q = ui.query.trim();
    ui.viewItems.forEach(function (item, index) {
      var isImage = item.type === 'image';
      var sub = isImage ? '图片 · 点击复制到剪贴板' : String(item.content || '').replace(/\s+/g, ' ');
      html += '<li class="row' + (index === ui.focusIndex ? ' is-active' : '') + '" data-id="' + esc(item.id) + '" data-index="' + index + '" tabindex="0" role="option" aria-selected="' + (index === ui.focusIndex ? 'true' : 'false') + '">' +
        '<span class="row-num">' + (index + 1) + '</span>' +
        '<div class="row-main"><div class="row-main-inner">' +
        (isImage ? '<img class="row-thumb" src="' + esc(item.imageUrl || item.image) + '" alt="">' : '') +
        '<div class="row-text">' +
        '<div class="row-title">' + highlight(item.title, q) + '</div>' +
        '<div class="row-sub">' + highlight(sub, q) + '</div>' +
        '</div></div></div>' +
        '<div class="row-side">' +
        '<span class="row-uses" title="使用 ' + (item.useCount || 0) + ' 次">' + (item.useCount || 0) + '</span>' +
        '<button class="row-more" type="button" data-more="' + esc(item.id) + '" title="更多">' + icon('more') + '</button>' +
        '</div></li>';
    });

    var hasItems = ui.viewItems.length > 0;
    el.list.hidden = !hasItems;
    el.empty.hidden = hasItems;

    if (hasItems) {
      var scrollTop = el.list.scrollTop;
      el.list.innerHTML = html;
      if (ui.listScrollReset) {
        el.list.scrollTop = 0;
        ui.listScrollReset = false;
      } else {
        el.list.scrollTop = scrollTop;
      }
      if (ui.scrollFocus) {
        var active = el.list.querySelector('.row.is-active');
        if (active) active.scrollIntoView({ block: 'nearest' });
        ui.scrollFocus = false;
      }
    } else {
      el.list.innerHTML = '';
      if (q) {
        el.emptyTitle.textContent = '没有找到「' + shorten(q, 18) + '」';
        el.emptyDesc.textContent = '换个关键词试试，或者新建一条。';
      } else if (ui.activeGroup !== 'all') {
        el.emptyTitle.textContent = '这个分组还没有词条';
        el.emptyDesc.textContent = '点下面的按钮新建一条，或者切回全部看看。';
      } else {
        el.emptyTitle.textContent = '还没有词条';
        el.emptyDesc.textContent = '把常用话术、Prompt、地址存进来，下次一键粘贴。';
      }
    }
  }

  function renderFootCount() {
    var count = ui.activeGroup === 'all'
      ? state.items.length
      : state.items.filter(function (item) { return item.groupId === ui.activeGroup; }).length;
    if (el.footCount) el.footCount.textContent = '共 ' + count + ' 条';
  }

  function renderAll() {
    renderTabs();
    renderList();
    renderFootCount();
  }

  function updateSearchUI() {
    el.searchEnter.hidden = !(ui.pendingQuery.trim() && ui.pendingQuery !== ui.query);
    el.searchClear.hidden = !el.searchInput.value;
  }

  function applySearch() {
    ui.query = el.searchInput.value.trim();
    ui.pendingQuery = el.searchInput.value;
    ui.focusIndex = 0;
    ui.listScrollReset = true;
    renderList();
    updateSearchUI();
  }

  function clearSearch() {
    el.searchInput.value = '';
    ui.pendingQuery = '';
    ui.query = '';
    ui.focusIndex = 0;
    ui.listScrollReset = true;
    renderList();
    updateSearchUI();
    el.searchInput.focus();
  }

  function moveFocus(delta) {
    if (!ui.viewItems.length) return;
    var len = ui.viewItems.length;
    ui.focusIndex = (ui.focusIndex + delta + len) % len;
    ui.scrollFocus = true;
    renderList();
  }

  function flashItem(itemId) {
    var row = el.list.querySelector('.row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(itemId) : itemId) + '"]');
    if (!row) return;
    row.classList.add('is-flash');
    setTimeout(function () { row.classList.remove('is-flash'); }, 720);
  }

  /* ==================== 剪贴板 ==================== */
  async function copyText(text) {
    if (!platform || !platform.clipboard) return false;
    try {
      var result = await platform.clipboard.writeText(String(text || ''));
      return !!result && result.ok !== false;
    } catch (e) {
      return false;
    }
  }

  async function copyImage() {
    /* 图片剪贴板统一走主进程：按词条或记录 id 复制 */
    return false;
  }

  var clipHoverId = null;

  function renderClipList() {
    var query = (el.clipSearch.value || '').trim().toLowerCase();
    var list = (state.clipboard || []).filter(function (entry) { return !query || [entry.content, entry.source, entry.type === 'image' ? '图片' : '文字'].join(' ').toLowerCase().indexOf(query) >= 0; });
    var scroller = el.clipList.closest('.func-body');
    var oldRows = Array.from(el.clipList.children);
    var ids = new Set(list.map(function (entry) { return entry.id; }));
    var anchor = oldRows.find(function (row) { return row.dataset.clipId === clipHoverId && ids.has(row.dataset.clipId); });
    if (!anchor && scroller && scroller.scrollTop > 0) {
      var top = scroller.getBoundingClientRect().top;
      anchor = oldRows.find(function (row) { return ids.has(row.dataset.clipId) && row.getBoundingClientRect().bottom > top; });
    }
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    if (!list.length) {
      el.clipList.innerHTML = '';
      el.clipList.hidden = true;
      el.clipEmpty.hidden = false;
      var emptyTitle = el.clipEmpty.querySelector('.clip-empty-title');
      var emptyDesc = el.clipEmpty.querySelector('.clip-empty-desc');
      if (emptyTitle) emptyTitle.textContent = query ? '没有匹配的记录' : '还没有剪贴板记录';
      if (emptyDesc) emptyDesc.textContent = query ? '试试其他关键词，或清空搜索查看全部记录。' : '复制文字或图片后，会自动记录在这里。';
      return;
    }
    el.clipList.hidden = false;
    el.clipEmpty.hidden = true;
    var template = document.createElement('template');
    template.innerHTML = list.map(function (entry) {
      var isImage = entry.type === 'image';
      var src = entry.imageUrl || entry.image;
      var thumb = isImage
        ? '<button class="clip-thumb" type="button" data-clip-action="view" data-clip-id="' + esc(entry.id) + '" title="查看大图"><img src="' + esc(src) + '" alt=""></button>'
        : '<div class="clip-thumb">' + icon('quote') + '</div>';
      var text = isImage ? '图片 · 点击查看大图' : esc(shorten(entry.content, 180));
      var source = esc(entry.source || '复制');
      return '<div class="clip-item" data-clip-id="' + esc(entry.id) + '">' +
        thumb +
        '<div class="clip-main">' +
        '<div class="clip-text">' + text + '</div>' +
        '<div class="clip-meta">' + formatClipTime(entry.createdAt) + ' · ' + source + ' · ' + (isImage ? '图片' : '文字') + '</div>' +
        '</div>' +
        '<div class="clip-item-actions">' +
        '<button class="clip-mini" type="button" data-clip-action="copy" data-clip-id="' + esc(entry.id) + '">' + (isImage ? '复制图片' : '复制') + '</button>' +
        '<button class="clip-mini" type="button" data-clip-action="paste" data-clip-id="' + esc(entry.id) + '">粘贴</button>' +
        '<button class="clip-mini" type="button" data-clip-action="view" data-clip-id="' + esc(entry.id) + '">查看</button>' +
        '<button class="clip-del" type="button" data-clip-action="delete" data-clip-id="' + esc(entry.id) + '" title="删除">' + icon('trash') + '</button>' +
        '</div>' +
        '</div>';
    }).join('');
    /* 复用已有行和按钮，避免更新恰好发生在按下、松开之间时丢掉点击。 */
    var byId = new Map(oldRows.map(function (row) { return [row.dataset.clipId, row]; }));
    var cursor = el.clipList.firstElementChild;
    Array.from(template.content.children).forEach(function (fresh) {
      var row = byId.get(fresh.dataset.clipId) || fresh;
      if (row !== fresh && row.innerHTML !== fresh.innerHTML) row.innerHTML = fresh.innerHTML;
      if (row !== cursor) el.clipList.insertBefore(row, cursor);
      else cursor = cursor.nextElementSibling;
    });
    oldRows.forEach(function (row) { if (!ids.has(row.dataset.clipId)) row.remove(); });
    if (anchor && anchor.isConnected && scroller) {
      scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    }
  }

  function updateClipStatus() {
    var watching = !!state.settings.clipboardWatch;
    var count = (state.clipboard || []).length;
    if (el.clipBadge) el.clipBadge.textContent = watching ? '实时监听' : '已暂停';
    if (el.clipStatusText) {
      el.clipStatusText.textContent = watching
        ? '正在监听系统剪贴板 · 已记录 ' + count + ' 条'
        : '已暂停 · 已记录 ' + count + ' 条';
    }
    if (el.clipStatusDot) el.clipStatusDot.classList.toggle('is-off', !watching);
    $$('.switch[data-setting="clipboardWatch"]').forEach(function (btn) {
      var on = !!state.settings.clipboardWatch;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function formatClipTime(ts) {
    var d = new Date(ts);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* 监听由主进程负责，这里保留空实现给旧调用点复用 */
  function startClipPolling() { updateClipStatus(); }
  function stopClipPolling() { }
  function recordClipboard() { return false; }
  var clipPollDenied = false;

  async function refreshClipboard() {
    if (!platform || !platform.clipboard) return;
    try {
      var result = await platform.clipboard.readNow();
      if (result && result.state) adoptState(result.state);
      renderClipList();
      updateClipStatus();
    } catch (e) { /* ignore */ }
  }

  async function readClipboardNow() {
    if (!platform || !platform.clipboard) return;
    var before = (state.clipboard || []).length;
    await refreshClipboard();
    if ((state.clipboard || []).length > before) toast('已读取剪贴板内容');
    else toast('剪贴板里没有新的内容', true);
  }

  function applyClipViewerZoom() {
    if (!el.clipViewerStage || !el.clipViewerImg) return;
    var zoom = ui.clipViewerZoom || 1;
    el.clipViewerZoomLabel.textContent = Math.round(zoom * 100) + '%';
    if (!el.clipViewerStage.classList.contains('is-visible')) return;
    var naturalWidth = el.clipViewerImg.naturalWidth || 1;
    var naturalHeight = el.clipViewerImg.naturalHeight || 1;
    var availableWidth = Math.max(1, el.clipViewerStage.clientWidth - 24);
    var availableHeight = Math.max(1, el.clipViewerStage.clientHeight - 24);
    var fitScale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
    el.clipViewerImg.style.width = Math.max(1, Math.round(naturalWidth * fitScale * zoom)) + 'px';
    el.clipViewerImg.style.height = Math.max(1, Math.round(naturalHeight * fitScale * zoom)) + 'px';
    el.clipViewerStage.classList.toggle('is-fit', zoom === 1);
  }

  function setClipViewerZoom(value) {
    ui.clipViewerZoom = Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
    applyClipViewerZoom();
  }

  function openClipViewer(entry) {
    if (!entry) return;
    ui.clipViewerId = entry.id;
    ui.clipViewerZoom = 1;
    var image = entry.type === 'image';
    el.clipViewer.classList.toggle('is-image', image);
    el.clipViewerTitle.textContent = image ? '图片记录' : '文字记录';
    el.clipViewerStage.hidden = !image;
    el.clipViewerStage.classList.toggle('is-visible', image);
    el.clipViewerControls.hidden = !image;
    el.clipViewerText.hidden = image;
    el.clipViewerText.textContent = image ? '' : entry.content;
    if (image) {
      el.clipViewerImg.src = entry.imageUrl || entry.image;
      el.clipViewerStage.scrollTop = 0;
      el.clipViewerStage.scrollLeft = 0;
    } else {
      el.clipViewerImg.removeAttribute('src');
    }
    el.clipViewerMeta.textContent = formatClipTime(entry.createdAt) + ' · ' + (entry.source || '复制');
    el.clipViewerCopy.hidden = !entry.id;
    el.clipViewerPaste.hidden = !entry.id;
    el.clipViewer.hidden = false;
    el.clipViewerZoomLabel.textContent = '100%';
    if (image) requestAnimationFrame(applyClipViewerZoom);
  }

  function closeClipViewer() {
    ui.clipViewerId = null;
    el.clipViewerStage.classList.remove('is-visible');
    if (el.clipViewer) el.clipViewer.hidden = true;
  }

  async function pasteClipboardEntry(entry) {
    if (!entry || !platform || !platform.clipboard) return;
    closeClipViewer();
    var result = await platform.clipboard.paste(entry.id);
    if (result && result.ok === false) {
      toast(result.error || '粘贴失败', true);
      return;
    }
    toast(entry.type === 'image' ? '图片已粘贴到前台窗口' : '内容已粘贴到前台窗口');
  }

  async function copyClipboardEntry(entry) {
    if (!entry || !platform || !platform.clipboard) return;
    var result = await platform.clipboard.copy(entry.id);
    var ok = !result || result.ok !== false;
    toast(ok ? (entry.type === 'image' ? '图片已复制到剪贴板' : '内容已复制到剪贴板') : (result.error || '复制失败'), !ok);
  }

  async function clearClipboardHistory() {
    var ok = await askConfirm({
      title: '清空剪贴板记录',
      message: '所有文字和图片记录都会删除，不能恢复。',
      okText: '清空'
    });
    if (!ok) return;
    if (platform && platform.clipboard) {
      var result = await platform.clipboard.clear();
      if (result && result.state) adoptState(result.state);
    }
    state.clipboard = [];
    renderClipList();
    updateClipStatus();
    closeClipViewer();
    toast('剪贴板记录已清空');
  }

  /* 系统剪贴板只认位图，SVG 的 data URL 要先在画布上转成 PNG 才能写进去 */
  async function ensureClipboardImage(item) {
    if (!item || item.type !== 'image') return true;
    var src = item.image || '';
    if (!/^data:image\/svg/i.test(src)) return true;
    try {
      var img = new Image();
      img.src = src;
      if (img.decode) await img.decode();
      else await new Promise(function (resolve, reject) {
        img.onload = resolve;
        img.onerror = reject;
      });
      var w = img.naturalWidth || 640;
      var h = img.naturalHeight || 640;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var png = canvas.toDataURL('image/png');
      var saved = await platform.media.saveImage({ id: item.id, dataUrl: png });
      if (!saved || !saved.ok) return false;
      item.image = saved.ref;
      item.imageUrl = saved.url;
      saveState();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 点词条：写入剪贴板 → 隐藏面板 → 粘贴到刚才的前台窗口 */
  async function insertItem(item) {
    if (!item) return;
    if (item.type === 'image') {
      var ready = await ensureClipboardImage(item);
      if (!ready) {
        toast('图片准备失败，换一张试试', true);
        return;
      }
    }
    var result = await platform.snippet.activate(item.id);
    if (result && result.ok === false) {
      toast(result.error || '粘贴失败', true);
      return;
    }
    if (state.settings.recordUsage) {
      item.useCount = (item.useCount || 0) + 1;
      item.lastUsedAt = Date.now();
      saveState();
      renderList();
      flashItem(item.id);
    }
  }


  /* ==================== 菜单 ==================== */
  function closeRowMenu() { el.rowMenu.classList.remove('is-open'); }
  function closeTrayMenu() { el.trayMenu.classList.remove('is-open'); }
  function closeGroupMenu() {
    el.groupMenu.classList.remove('is-open');
    el.groupMenu.removeAttribute('data-group-id');
  }
  function closeMenus() {
    closeRowMenu();
    closeTrayMenu();
    closeGroupMenu();
  }

  function openTrayMenu() {
    closeRowMenu();
    el.trayMenu.classList.add('is-open');
    var rect = el.trayBtn.getBoundingClientRect();
    var mw = el.trayMenu.offsetWidth;
    var mh = el.trayMenu.offsetHeight;
    el.trayMenu.style.left = clamp(rect.right - mw, 12, innerWidth - mw - 12) + 'px';
    el.trayMenu.style.top = Math.max(12, rect.top - mh - 8) + 'px';
    el.trayMenu.style.transformOrigin = 'bottom right';
  }

  function openRowMenu(anchor, item) {
    closeTrayMenu();
    var isImage = item.type === 'image';
    el.rowMenu.innerHTML =
      '<button class="menu-item" type="button" data-row-action="edit">' + icon('edit') + ' 编辑<kbd>Enter</kbd></button>' +
      '<button class="menu-item" type="button" data-row-action="copy">' + icon('copy') + ' ' + (isImage ? '复制图片' : '复制文字') + '</button>' +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item danger" type="button" data-row-action="delete">' + icon('trash') + ' 删除</button>';
    el.rowMenu.dataset.itemId = item.id;
    el.rowMenu.classList.add('is-open');
    var rect = anchor.getBoundingClientRect();
    var mw = el.rowMenu.offsetWidth;
    var mh = el.rowMenu.offsetHeight;
    var left = clamp(rect.right - mw, 12, innerWidth - mw - 12);
    var top = rect.bottom + 8;
    if (top + mh > innerHeight - 12) top = rect.top - mh - 8;
    el.rowMenu.style.left = left + 'px';
    el.rowMenu.style.top = Math.max(12, top) + 'px';
  }

  function openGroupMenu(event, group) {
    closeMenus();
    el.groupMenu.innerHTML =
      '<button class="menu-item" type="button" data-group-action="rename">' + icon('edit') + ' 重命名</button>' +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item danger" type="button" data-group-action="delete">' + icon('trash') + ' 删除分组</button>';
    el.groupMenu.dataset.groupId = group.id;
    el.groupMenu.classList.add('is-open');
    var mw = el.groupMenu.offsetWidth;
    var mh = el.groupMenu.offsetHeight;
    var left = clamp(event.clientX, 12, innerWidth - mw - 12);
    var top = event.clientY + 8;
    var placeAbove = top + mh > innerHeight - 12;
    if (placeAbove) top = event.clientY - mh - 8;
    el.groupMenu.style.left = left + 'px';
    el.groupMenu.style.top = Math.max(12, top) + 'px';
    el.groupMenu.style.transformOrigin = (placeAbove ? 'bottom' : 'top') + ' left';
  }

  /* ==================== 窗口与视图导航 ==================== */
  /* 每个视图是独立 BrowserWindow；这里的“打开/关闭”都是让主进程显隐窗口 */
  function inPanelWindow() { return VIEW === 'panel'; }
  function isLauncherOpen() { return VIEW === 'launcher'; }
  function isAiHubOpen() { return VIEW === 'aiHub'; }
  function isClipWindowOpen() { return VIEW === 'clip'; }
  function isPetWindowOpen() { return VIEW === 'petSettings'; }
  function isAIDialogOpen() { return VIEW === 'aiDialog'; }
  function isPanelVisible() { return VIEW === 'panel'; }

  function hideFunctionWindows() { }

  function currentVisibleWindow() {
    return VIEW === 'petSettings' ? 'pet' : VIEW;
  }

  function activeWindowElement() {
    if (VIEW === 'panel') return el.panel;
    if (VIEW === 'launcher') return el.launcherWindow;
    if (VIEW === 'aiHub') return el.aiHubWindow;
    if (VIEW === 'aiPrefs') return el.aiPrefsWindow;
    if (VIEW === 'clip') return el.clipWindow;
    if (VIEW === 'petSettings') return el.petWindow;
    if (VIEW === 'aiDialog') return el.aiWindow;
    return null;
  }

  function showMainPanel() {
    ui.page = 'main';
    if (platform && platform.nav) platform.nav.open('panel');
  }

  function openLauncher() {
    closeMenus();
    hideSelectPill();
    if (platform && platform.nav) platform.nav.open('launcher');
  }

  function closeLauncher(restore) {
    if (restore !== false) showMainPanel();
    else if (platform && platform.window) platform.window.hide('launcher');
  }

  function openFunction(name) {
    closeMenus();
    hideSelectPill();
    if (name === 'ai') name = 'aiHub';
    if (name === 'pets' || name === 'pet') name = 'petSettings';
    if (platform && platform.nav) platform.nav.open(name);
  }

  function openSettings(section) {
    closeMenus();
    hideSelectPill();
    if (platform && platform.nav) platform.nav.openSettings(section || '');
    applySettingsOpen(section);
  }

  /* 主面板窗口真正把设置页铺开 */
  function applySettingsOpen(section) {
    el.panel.classList.add('is-fx-page', 'is-settings');
    el.settings.classList.add('is-open');
    ui.page = 'settings';
    fillSettings();
    if (section === 'ai') {
      requestAnimationFrame(function () {
        el.aiSettingsGroup.scrollIntoView({ block: 'start', behavior: 'smooth' });
        el.aiSettingsGroup.classList.add('is-flash');
        setTimeout(function () { el.aiSettingsGroup.classList.remove('is-flash'); }, 1500);
      });
    } else if (el.settingsBody) {
      el.settingsBody.scrollTop = 0;
    }
  }

  function closeSettings() {
    el.settings.classList.remove('is-open');
    el.panel.classList.remove('is-settings', 'is-fx-page');
    ui.page = 'main';
  }

  /* ==================== 面板显隐 ==================== */
  function showPanel() {
    if (platform && platform.nav) platform.nav.open('panel');
  }
  function hidePanel(showTip) {
    closeMenus();
    hideSelectPill();
    if (platform && platform.window) platform.window.hide('panel', !!showTip);
    else if (showTip) toast('已收进托盘，程序仍在后台运行');
  }
  /* ==================== 设置页 ==================== */
  function fillSettings() {
    $$('[data-seg="theme"] button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.value === state.settings.theme);
    });
    $$('[data-seg="size"] button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.value === state.settings.panelSize);
    });
    $$('.switch[data-setting]').forEach(function (btn) {
      var on = !!state.settings[btn.dataset.setting];
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    el.aiBaseUrl.value = state.settings.ai.baseUrl || '';
    el.aiApiKey.value = state.settings.ai.apiKey || '';
    el.aiModel.value = state.settings.ai.model || '';
    el.aiApiKey.type = 'password';
    el.apiKeyEye.innerHTML = icon('eye');
    renderHotkeyButtons();
    updatePinUI();
  }

  function renderAIPageSummary() {
    var persona = getPersona();
    var prompt = getPrompt();
    el.aiPagePersona.textContent = persona ? persona.name : '空';
    el.aiPagePrompt.textContent = prompt ? prompt.name : '空';
    el.aiPageModel.textContent = state.settings.ai.model || '未设置';
    refreshHotkeyDisplays();
    el.homeSnippetStatus.textContent = state.items.length ? state.items.length + ' 条常用内容，点击即粘贴' : '添加你的第一条常用文字或图片';
    el.homeClipboardStatus.textContent = (state.clipboard || []).length + ' 条记录' + (state.settings.clipboardWatch ? '，正在监听' : '，已暂停监听');
    el.homePetStatus.textContent = state.settings.petEnabled ? '桌宠已显示，点击管理' : '形象、原声录音与自定义接话';
    el.homePetCount.textContent = (state.pets || []).length + ' 只桌宠';
  }

  function renderAIPrefsSettings() {
    if (!el.aiUserContextInput || !el.aiPrefPromptList) return;
    var context = String(state.settings.ai.userContext || '');
    if (el.aiHubUserContext && document.activeElement !== el.aiHubUserContext) el.aiHubUserContext.value = context;
    if (document.activeElement !== el.aiUserContextInput) el.aiUserContextInput.value = context;
    el.aiPrefPromptList.innerHTML = state.prompts.map(function (prompt) {
      var current = prompt.id === state.settings.promptId;
      return '<div class="preset-row">' +
        '<div class="preset-main"><div class="preset-name">' + esc(prompt.name) + '</div>' +
        '<div class="preset-text">' + esc(shorten(prompt.text, 180)) + '</div></div>' +
        '<div class="preset-row-actions">' +
        '<button type="button" data-ai-pref-prompt-use="' + esc(prompt.id) + '" class="' + (current ? 'is-current' : '') + '">' + (current ? '使用中' : '使用') + '</button>' +
        '<button type="button" data-ai-pref-prompt-edit="' + esc(prompt.id) + '">编辑</button>' +
        '<button class="preset-del" type="button" data-ai-pref-prompt-delete="' + esc(prompt.id) + '" title="删除">' + icon('trash') + '</button>' +
        '</div></div>';
    }).join('');
  }

  function openAIPrefPrompt(id) {
    var prompt = state.prompts.find(function (item) { return item.id === id; }) || null;
    el.aiPrefPromptEditor.dataset.id = prompt ? prompt.id : '';
    el.aiPrefPromptEditorTitle.textContent = prompt ? '编辑提示词' : '新建提示词';
    el.aiPrefPromptName.value = prompt ? prompt.name : '';
    el.aiPrefPromptText.value = prompt ? prompt.text : '';
    el.aiPrefPromptEditor.hidden = false;
    el.aiPrefPromptName.focus({ preventScroll: true });
  }

  function saveAIPrefPrompt() {
    var name = el.aiPrefPromptName.value.trim();
    var text = el.aiPrefPromptText.value.trim();
    if (!name || !text) {
      toast('请填写名称和完整指令', true);
      (!name ? el.aiPrefPromptName : el.aiPrefPromptText).focus();
      return;
    }
    var id = el.aiPrefPromptEditor.dataset.id || '';
    var prompt = state.prompts.find(function (item) { return item.id === id; });
    if (prompt) {
      prompt.name = name;
      prompt.text = text;
    } else {
      prompt = { id: uid('p'), name: name, text: text };
      state.prompts.push(prompt);
    }
    state.settings.promptId = prompt.id;
    saveState();
    el.aiPrefPromptEditor.hidden = true;
    renderAIPrefsSettings();
    renderAIChips();
    renderAIPageSummary();
    toast('提示词已保存并使用');
  }

  function updateAIStatus() {
    var config = state.settings.ai;
    var local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(config.baseUrl || '');
    var configured = !!(config.baseUrl && config.model && (config.apiKey || local));
    var verified = configured && config.connection && config.connection.ok && config.connection.baseUrl === config.baseUrl && config.connection.model === config.model;
    var model = (config.availableModels || []).find(function (item) { return item.id === config.model; });
    var label = !config.baseUrl ? '请配置服务连接' : !config.model ? '请选择模型' : !(config.apiKey || local) ? '请填写 API Key' : verified ? '连接已验证' : '已配置，尚未验证';
    el.aiModelChip.textContent = model ? model.name : config.model || '未配置模型';
    el.aiStatusText.textContent = label;
    el.aiDot.classList.toggle('is-off', !verified);
    el.aiSendBtn.disabled = !ui.aiRequestId && !configured;
    el.aiSendBtn.setAttribute('aria-label', ui.aiRequestId ? '停止生成' : '发送问题');
    el.homeAIStatus.textContent = configured ? '直接提问、划词与截图分析' : '配置服务后开始使用';
    el.aiHubConnection.textContent = label;
    el.aiHubBadge.textContent = verified ? '已连接' : configured ? '待验证' : '待配置';
  }

  async function loadAIModels() {
    var button = el.loadModelsBtn;
    button.disabled = true;
    button.textContent = '读取中…';
    try {
      var result = await platform.ai.models(state.settings.ai);
      if (!result || !result.ok) throw new Error(result && result.error || '读取模型失败');
      state.settings.ai.availableModels = result.models;
      el.aiModelOptions.innerHTML = result.models.map(function (model) { return '<option value="' + esc(model.id) + '">' + esc(model.name) + (model.supportsImages ? ' · 支持图片' : '') + '</option>'; }).join('');
      if (!state.settings.ai.model && result.models.length) {
        var selected = result.models.find(function (model) { return model.id === 'deepseek-v4.1-flash'; }) || result.models[0];
        state.settings.ai.model = selected.id;
        state.settings.ai.supportsImages = selected.supportsImages;
        el.aiModel.value = selected.id;
      }
      saveState();
      updateAIStatus();
      renderAIPageSummary();
      el.aiConnectionFeedback.textContent = result.models.length ? '已读取 ' + result.models.length + ' 个可用模型，请选择模型并测试连接。' : '接口没有返回可用模型，可手动填写模型 ID。';
    } catch (err) { el.aiConnectionFeedback.textContent = err.message; toast(err.message, true); }
    finally { button.disabled = false; button.textContent = '获取模型'; }
  }

  async function testAIConnection() {
    var button = el.testApiBtn;
    button.disabled = true;
    button.textContent = '正在验证…';
    el.aiConnectionFeedback.textContent = '正在向所选模型发送一条最小测试请求…';
    try {
      await platform.state.set(state);
      var result = await platform.ai.test(state.settings.ai);
      if (!result || !result.ok) throw new Error(result && result.error || '连接失败');
      state.settings.ai.connection = { ok: true, baseUrl: state.settings.ai.baseUrl, model: state.settings.ai.model, checkedAt: Date.now(), latencyMs: result.result.latencyMs };
      saveState();
      el.aiConnectionFeedback.textContent = '所选模型已实际返回回答，连接耗时 ' + (result.result.latencyMs / 1000).toFixed(1) + ' 秒。';
      toast('连接验证成功');
    } catch (err) {
      state.settings.ai.connection = null;
      saveState();
      el.aiConnectionFeedback.textContent = err.message;
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.innerHTML = icon('refresh') + ' 测试连接';
      updateAIStatus();
    }
  }

  async function exportData() {
    if (!platform || !platform.data) return;
    var result = await platform.data.export();
    if (!result || result.canceled) return;
    if (result.ok) toast('已导出备份（不含 API Key）');
    else toast(result.error || '导出失败', true);
  }

  function normalizeItem(item) {
    var fallbackGroup = state.groups[0] ? state.groups[0].id : 'reply';
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

  async function importData() {
    if (!platform || !platform.data) return;
    var result = await platform.data.import();
    if (!result || result.canceled) return;
    if (!result.ok) {
      toast(result.error || '导入失败：不是有效的备份文件', true);
      return;
    }
    ui.activeGroup = 'all';
    ui.query = '';
    ui.pendingQuery = '';
    ui.focusIndex = 0;
    ui.listScrollReset = true;
    el.searchInput.value = '';
    toast('导入完成');
  }

  async function resetAll() {
    var ok = await askConfirm({
      title: '重置工具箱',
      message: '当前词条、分组、预设和设置都会清空，回到最初的状态。这个操作不能撤销。',
      okText: '重置'
    });
    if (!ok) return;
    if (platform && platform.data) {
      var result = await platform.data.reset();
      if (result && result.state) adoptState(result.state);
    }
    ui.activeGroup = 'all';
    ui.query = '';
    ui.pendingQuery = '';
    el.searchInput.value = '';
    ui.focusIndex = 0;
    ui.listScrollReset = true;
    toast('工具箱已重置');
  }
  /* ==================== 确认框 ==================== */
  function askConfirm(options) {
    return new Promise(function (resolve) {
      ui.confirmResolve = resolve;
      el.confirmTitle.textContent = options.title || '确认';
      el.confirmText.textContent = options.message || '';
      el.confirmOk.textContent = options.okText || '确定';
      el.confirmLayer.classList.add('is-open');
    });
  }

  function closeConfirm(result) {
    el.confirmLayer.classList.remove('is-open');
    if (ui.confirmResolve) {
      var resolve = ui.confirmResolve;
      ui.confirmResolve = null;
      resolve(!!result);
    }
  }

  /* ==================== 词条编辑 ==================== */
  function setEntryType(type) {
    ui.entryType = type === 'image' ? 'image' : 'text';
    $$('button[data-type]', el.entryTypeSeg).forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.type === ui.entryType);
    });
    el.entryTextWrap.hidden = ui.entryType !== 'text';
    el.entryImageWrap.hidden = ui.entryType !== 'image';
  }

  function setEntryPreview(src) {
    ui.entryImageData = src || '';
    if (src) {
      el.entryPreview.src = src;
      el.entryPreview.hidden = false;
      el.dropzone.classList.add('has-image');
    } else {
      el.entryPreview.removeAttribute('src');
      el.entryPreview.hidden = true;
      el.dropzone.classList.remove('has-image');
    }
  }

  function loadEntryImage(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast('请选择图片文件', true);
      return;
    }
    if (file.size > 3.5 * 1024 * 1024) {
      toast('图片超过 3.5MB，换一张小一点的', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      setEntryPreview(String(reader.result || ''));
      setEntryType('image');
    };
    reader.onerror = function () { toast('图片读取失败', true); };
    reader.readAsDataURL(file);
  }

  function openEntry(item, presetGroupId) {
    closeMenus();
    hideSelectPill();
    ui.entryEditingId = item ? item.id : null;
    el.entryTitle.textContent = item ? '编辑词条' : '新建词条';
    el.entryTitleInput.value = item ? item.title || '' : '';
    el.entryContent.value = item && item.type === 'text' ? item.content || '' : '';
    setEntryPreview(item && item.type === 'image' ? (item.imageUrl || item.image) : '');
    setEntryType(item ? item.type : 'text');
    el.entryFile.value = '';

    var groupId = item ? item.groupId : (presetGroupId || (ui.activeGroup !== 'all' ? ui.activeGroup : (state.groups[0] && state.groups[0].id)));
    el.entryGroup.innerHTML = state.groups.map(function (group) {
      return '<option value="' + esc(group.id) + '">' + esc(group.name) + '</option>';
    }).join('');
    if (groupId && state.groups.some(function (g) { return g.id === groupId; })) {
      el.entryGroup.value = groupId;
    }

    el.entryLayer.classList.add('is-open');
    setTimeout(function () { el.entryTitleInput.focus(); }, 80);
  }

  function closeEntry() {
    el.entryLayer.classList.remove('is-open');
    el.entryFile.value = '';
    setEntryPreview('');
    ui.entryEditingId = null;
  }

  function saveEntry() {
    var type = ui.entryType;
    var title = el.entryTitleInput.value.trim();
    var content = el.entryContent.value.trim();
    var groupId = el.entryGroup.value;
    if (!groupId) { toast('先创建一个分组', true); return; }
    if (type === 'text' && !content) { toast('内容不能为空', true); el.entryContent.focus(); return; }
    if (type === 'image' && !ui.entryImageData) { toast('先选择或粘贴一张图片', true); return; }
    var finalTitle = title || (type === 'text' ? shorten(content, 18) : '图片词条');
    var editingId = ui.entryEditingId;
    var savedId;

    if (editingId) {
      var item = state.items.find(function (it) { return it.id === editingId; });
      if (item) {
        item.type = type;
        item.title = finalTitle;
        item.content = type === 'text' ? content : '';
        item.image = type === 'image' ? ui.entryImageData : '';
        item.groupId = groupId;
        savedId = item.id;
      }
    } else {
      var newItem = {
        id: uid('n'),
        type: type,
        title: finalTitle,
        content: type === 'text' ? content : '',
        image: type === 'image' ? ui.entryImageData : '',
        groupId: groupId,
        useCount: 0,
        createdAt: Date.now(),
        lastUsedAt: 0
      };
      state.items.unshift(newItem);
      savedId = newItem.id;
    }

    saveState();
    closeEntry();
    ui.activeGroup = 'all';
    ui.query = '';
    ui.pendingQuery = '';
    el.searchInput.value = '';
    ui.focusIndex = 0;
    ui.listScrollReset = true;
    renderAll();
    updateSearchUI();
    toast(editingId ? '词条已更新' : '词条已保存');
    if (savedId) flashItem(savedId);
  }

  /* ==================== 分组 ==================== */
  function openGroupModal(group) {
    closeMenus();
    ui.groupEditingId = group ? group.id : null;
    el.groupTitle.textContent = group ? '重命名分组' : '新建分组';
    el.groupNameInput.value = group ? group.name : '';
    el.groupSave.textContent = group ? '保存' : '创建';
    el.groupLayer.classList.add('is-open');
    setTimeout(function () { el.groupNameInput.focus(); }, 80);
  }

  function saveGroup() {
    var name = el.groupNameInput.value.trim();
    if (!name) { toast('分组名称不能为空', true); return; }
    var editingId = ui.groupEditingId;
    var exists = state.groups.some(function (g) {
      return g.id !== editingId && g.name.toLowerCase() === name.toLowerCase();
    });
    if (exists) { toast('已经有同名分组了', true); return; }
    if (editingId) {
      var current = state.groups.find(function (g) { return g.id === editingId; });
      if (!current) { toast('这个分组已经不存在了', true); return; }
      current.name = name;
      ui.groupEditingId = null;
      saveState();
      el.groupLayer.classList.remove('is-open');
      renderAll();
      toast('分组已重命名');
      return;
    }
    var group = { id: uid('g'), name: name };
    state.groups.push(group);
    saveState();
    ui.activeGroup = group.id;
    ui.query = '';
    ui.pendingQuery = '';
    el.searchInput.value = '';
    ui.focusIndex = 0;
    ui.listScrollReset = true;
    el.groupLayer.classList.remove('is-open');
    renderAll();
    updateSearchUI();
    toast('分组已创建');
  }

  async function deleteGroup(group) {
    var index = state.groups.findIndex(function (g) { return g.id === group.id; });
    if (index < 0) return;
    if (state.groups.length <= 1) {
      toast('至少保留一个分组，不能删除最后一个分组', true);
      return;
    }
    var target = state.groups[index > 0 ? index - 1 : index + 1];
    var count = state.items.filter(function (item) { return item.groupId === group.id; }).length;
    var confirmed = await askConfirm({
      title: '删除分组',
      message: '「' + group.name + '」将被删除，组内 ' + count + ' 条词条会移到「' + target.name + '」。词条本身不会删除。',
      okText: '删除分组'
    });
    if (!confirmed) return;
    state.groups = state.groups.filter(function (item) { return item.id !== group.id; });
    state.items.forEach(function (item) {
      if (item.groupId === group.id) item.groupId = target.id;
    });
    if (ui.activeGroup === group.id) ui.activeGroup = target.id;
    if (ui.groupEditingId === group.id) ui.groupEditingId = null;
    saveState();
    renderAll();
    updateSearchUI();
    toast('分组已删除，' + count + ' 条词条已移到「' + target.name + '」');
  }

  /* ==================== 预设 ==================== */
  function getPersona() {
    if (!state.settings.personaId) return null;
    return state.personas.find(function (p) { return p.id === state.settings.personaId; }) || state.personas[0] || null;
  }

  function getPrompt() {
    if (!state.settings.promptId) return null;
    return state.prompts.find(function (p) { return p.id === state.settings.promptId; }) || state.prompts[0] || null;
  }

  function aiTemplateText(preset) {
    return preset && preset.text ? String(preset.text).trim() : '';
  }

  function aiComposerText(persona, prompt) {
    return [aiTemplateText(persona), aiTemplateText(prompt)].filter(Boolean).join('\n\n');
  }

  function fillAIComposerFromPresets(extra) {
    if (!el.aiQuestion) return;
    var persona = getPersona();
    var prompt = getPrompt();
    var value = aiComposerText(persona, prompt);
    var addition = String(extra || '').trim();
    if (addition) value = value ? value + '\n\n' + addition : addition;
    el.aiQuestion.value = value;
    ui.aiComposer.personaId = persona ? persona.id : '';
    ui.aiComposer.promptId = prompt ? prompt.id : '';
    ui.aiComposer.lastValue = value;
    ui.aiComposer.suppressAutoFill = !!addition;
  }

  function insertAIComposerTemplate(kind, text) {
    if (!text) return el.aiQuestion.value;
    var current = String(el.aiQuestion.value || '');
    if (!current) return text;
    if (kind === 'persona') {
      var promptText = aiTemplateText(getPrompt());
      var promptIndex = promptText ? current.indexOf(promptText) : -1;
      if (promptIndex >= 0) return current.slice(0, promptIndex) + text + '\n\n' + current.slice(promptIndex);
      return text + '\n\n' + current;
    }
    return current + '\n\n' + text;
  }

  function updateAIComposerPreset(kind, oldPreset, newPreset) {
    if (!el.aiQuestion) return;
    var current = String(el.aiQuestion.value || '');
    var oldText = aiTemplateText(oldPreset);
    var newText = aiTemplateText(newPreset);
    if (!current.trim() || current === ui.aiComposer.lastValue) {
      fillAIComposerFromPresets();
      return;
    }
    if (oldText && current.indexOf(oldText) >= 0) {
      el.aiQuestion.value = current.replace(oldText, function () { return newText; })
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\s*\n+/, '')
        .replace(/\n+\s*$/, '');
    } else if (newText && current.indexOf(newText) < 0) {
      el.aiQuestion.value = insertAIComposerTemplate(kind, newText);
    }
    ui.aiComposer.personaId = (getPersona() || {}).id || '';
    ui.aiComposer.promptId = (getPrompt() || {}).id || '';
    ui.aiComposer.lastValue = aiComposerText(getPersona(), getPrompt());
    ui.aiComposer.suppressAutoFill = String(el.aiQuestion.value || '') !== ui.aiComposer.lastValue;
  }

  function selectAIPreset(kind, id) {
    var oldPreset = kind === 'persona' ? getPersona() : getPrompt();
    var list = kind === 'persona' ? state.personas : state.prompts;
    var nextPreset = list.find(function (item) { return item.id === id; }) || null;
    state.settings[kind === 'persona' ? 'personaId' : 'promptId'] = nextPreset ? nextPreset.id : id;
    if (VIEW === 'aiDialog') updateAIComposerPreset(kind, oldPreset, nextPreset);
    return nextPreset;
  }

  function syncAIComposerIfPristine() {
    if (VIEW !== 'aiDialog' || ui.aiComposer.suppressAutoFill) return;
    if (el.aiQuestion.value !== ui.aiComposer.lastValue) return;
    fillAIComposerFromPresets();
  }

  function renderAIChips() {
    var persona = getPersona();
    var prompt = getPrompt();
    el.personaChips.innerHTML = '<button class="ai-chip' + (!persona ? ' is-active' : '') + '" type="button" data-persona="" title="不使用人设">空</button>' + state.personas.map(function (p) {
      return '<button class="ai-chip' + (persona && p.id === persona.id ? ' is-active' : '') + '" type="button" data-persona="' + esc(p.id) + '" title="' + esc(p.text) + '">' + esc(p.name) + '</button>';
    }).join('') + '<button class="ai-chip is-add" type="button" data-add-persona>' + icon('plus') + ' 自定义</button>';
    el.promptChips.innerHTML = '<button class="ai-chip' + (!prompt ? ' is-active' : '') + '" type="button" data-prompt="" title="不使用提示词">空</button>' + state.prompts.map(function (p) {
      return '<button class="ai-chip' + (prompt && p.id === prompt.id ? ' is-active' : '') + '" type="button" data-prompt="' + esc(p.id) + '" title="' + esc(p.text) + '">' + esc(p.name) + '</button>';
    }).join('') + '<button class="ai-chip is-add" type="button" data-add-prompt>' + icon('plus') + ' 自定义</button>';
    el.personaCurrent.textContent = persona ? persona.name : '空';
    el.promptCurrent.textContent = prompt ? prompt.name : '空';
    el.aiPresetPreview.textContent = [persona && persona.text, prompt && prompt.text].filter(Boolean).join(' · ');
  }

  function renderPresetLists() {
    function rows(list, kind) {
      if (!list.length) return '<div class="preset-empty">还没有预设</div>';
      return list.map(function (p) {
        return '<div class="preset-row">' +
          '<div class="preset-main">' +
          '<div class="preset-name">' + esc(p.name) + '</div>' +
          '<div class="preset-text">' + esc(p.text) + '</div>' +
          '</div>' +
          '<div class="preset-row-actions">' +
          '<button type="button" data-use-preset="' + kind + '" data-preset-id="' + esc(p.id) + '" class="' + (state.settings[kind === 'persona' ? 'personaId' : 'promptId'] === p.id ? 'is-current' : '') + '">' + (state.settings[kind === 'persona' ? 'personaId' : 'promptId'] === p.id ? '使用中' : '使用') + '</button>' +
          '<button type="button" data-edit-preset="' + kind + '" data-preset-id="' + esc(p.id) + '">编辑</button>' +
          '<button class="preset-del" type="button" data-del-kind="' + kind + '" data-del-id="' + esc(p.id) + '" title="删除">' + icon('trash') + '</button></div>' +
          '</div>';
      }).join('');
    }
    el.personaList.innerHTML = rows(state.personas, 'persona');
    el.promptList.innerHTML = rows(state.prompts, 'prompt');
  }

  function openPresetModal() {
    closeMenus();
    renderPresetLists();
    el.presetLayer.classList.add('is-open');
    el.presetEditor.hidden = true;
    ui.aiCustomKind = null;
    el.personaAddInput.value = '';
    el.promptAddInput.value = '';
  }

  function addPreset(kind) {
    var input = kind === 'persona' ? el.personaAddInput : el.promptAddInput;
    var text = input.value.trim();
    if (!text) { toast('写点内容再添加', true); input.focus(); return; }
    var preset = { id: uid('p'), name: shorten(text, 12), text: text };
    if (kind === 'persona') {
      state.personas.push(preset);
    } else {
      state.prompts.push(preset);
    }
    selectAIPreset(kind, preset.id);
    saveState();
    input.value = '';
    renderPresetLists();
    renderAIChips();
    renderAIPageSummary();
    toast('预设已添加');
  }

  function openAICustom(kind, editingId) {
    openPresetModal();
    ui.aiCustomKind = kind;
    ui.aiCustomEditingId = editingId || null;
    var list = kind === 'persona' ? state.personas : state.prompts;
    var preset = list.find(function (item) { return item.id === editingId; });
    el.presetEditorTitle.textContent = (preset ? '编辑' : '新建') + (kind === 'persona' ? '人设' : '提示词');
    el.presetName.value = preset ? preset.name : '';
    el.presetText.value = preset ? preset.text : '';
    el.presetEditor.hidden = false;
    var presetBody = el.presetEditor.closest('.m-body');
    if (presetBody) presetBody.scrollTop = presetBody.scrollHeight;
    el.presetName.focus({ preventScroll: true });
  }

  function saveAICustom() {
    var kind = ui.aiCustomKind;
    var name = el.presetName.value.trim();
    var text = el.presetText.value.trim();
    if (!kind) return;
    if (!name || !text) { toast('请填写名称和完整指令', true); (!name ? el.presetName : el.presetText).focus(); return; }
    var list = kind === 'persona' ? state.personas : state.prompts;
    var previous = kind === 'persona' ? getPersona() : getPrompt();
    var previousText = aiTemplateText(previous);
    if (list.some(function (item) { return item.name === name && item.id !== ui.aiCustomEditingId; })) { toast('已有同名预设，请换一个名称', true); return; }
    var preset = list.find(function (item) { return item.id === ui.aiCustomEditingId; });
    if (preset) { preset.name = name; preset.text = text; }
    else { preset = { id: uid('p'), name: name, text: text }; list.push(preset); }
    state.settings[kind === 'persona' ? 'personaId' : 'promptId'] = preset.id;
    if (VIEW === 'aiDialog') updateAIComposerPreset(kind, { text: previousText }, preset);
    saveState();
    el.presetEditor.hidden = true;
    ui.aiCustomKind = null;
    renderAIChips();
    renderAIPageSummary();
    if (el.presetLayer.classList.contains('is-open')) renderPresetLists();
    toast('已保存自定义预设');
  }

  /* ==================== AI 助手 ==================== */
  /* 划词气泡由主进程用系统能力接管，这里保留空实现给旧调用点 */
  function hideSelectPill() { }
  function showSelectPill() { }
  function selectSampleText() { }
  function triggerSelectAI() { toast('按 ' + (state.settings.hotkeys.select || 'Alt+Q') + ' 读取当前选中文字'); }

  function getSelectedText() {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') &&
        typeof ae.selectionStart === 'number' && ae.selectionEnd > ae.selectionStart) {
      return String(ae.value || '').slice(ae.selectionStart, ae.selectionEnd).trim();
    }
    var sel = window.getSelection();
    return sel ? String(sel.toString() || '').trim() : '';
  }

  function openAIText(text) {
    var clean = String(text || '').trim().slice(0, 4000);
    if (!clean) {
      toast('没有可提问的内容', true);
      return;
    }
    ui.aiContext = { type: 'text', text: clean };
    populateAIContext();
    if (platform && platform.nav) platform.nav.open('aiDialog');
  }

  function restoreWindowByName(name) {
    if (platform && platform.nav) platform.nav.open(name === 'pet' ? 'petSettings' : (name || 'panel'));
  }

  function openAIWindow(context) {
    ui.aiContext = context || { type: 'none' };
    ui.aiCustomKind = null;
    populateAIContext();
    renderAIChips();
    fillAIComposerFromPresets(context && context.question);
    resetAIResult();
    updateAIStatus();
    if (VIEW !== 'aiDialog' && platform && platform.nav) platform.nav.open('aiDialog');
    setTimeout(function () { el.aiQuestion.focus({ preventScroll: true }); }, 260);
  }

  function closeAI(restore) {
    stopAIStream();
    el.aiQuestion.blur();
    ui.aiContext = null;
    if (restore === false && platform && platform.window) platform.window.hide('aiDialog');
    else if (platform && platform.nav) platform.nav.closeAI();
  }

  function populateAIContext() {
    var ctx = ui.aiContext;
    el.aiContext.hidden = !ctx || ctx.type === 'none';
    if (!ctx || ctx.type === 'none') {
      el.aiCtxChip.textContent = '对话';
      el.aiSub.textContent = '直接提问，或带上文字与截图';
      el.aiCtxIcon.innerHTML = icon('quote');
      el.aiCtxText.textContent = '';
      el.aiCtxText.hidden = false;
      el.aiCtxMeta.textContent = '';
      el.aiExpand.hidden = true;
      el.aiCtxThumb.hidden = true;
      return;
    }
    var isImage = ctx.type === 'image';
    el.aiCtxChip.textContent = isImage ? '截图' : '划词';
    el.aiSub.textContent = isImage ? '已附带截图，可以直接提问' : '已读取选中内容，可以直接提问';
    el.aiCtxIcon.innerHTML = icon(isImage ? 'camera' : 'quote');
    el.aiCtxText.textContent = isImage ? '' : ctx.text;
    el.aiCtxText.hidden = isImage;
    el.aiCtxText.classList.remove('is-expanded');
    el.aiCtxMeta.textContent = isImage
      ? '截图 · ' + (ctx.width || '?') + ' × ' + (ctx.height || '?')
      : (ctx.text || '').length + ' 字 · 来自当前选中内容';
    el.aiExpand.hidden = isImage || (ctx.text || '').length < 100;
    el.aiExpand.textContent = '展开';
    el.aiCtxThumb.hidden = !isImage;
    el.aiCtxThumb.src = isImage ? (ctx.image || ctx.url || '') : '';
  }

  function resetAIResult() {
    stopAIStream();
    ui.aiFullText = '';
    el.aiResult.hidden = true;
    el.aiAnswer.textContent = '';
    el.aiEmpty.hidden = false;
    el.aiResult.classList.remove('is-error');
    el.aiResultLabel.textContent = '回答';
    setAISending(false);
  }

  function setAISending(sending) {
    el.aiSendBtn.classList.toggle('is-stop', !!sending);
    el.aiSendBtn.innerHTML = icon(sending ? 'stop' : 'send');
    el.aiSendBtn.title = sending ? '停止生成' : '发送';
    el.aiCopyBtn.disabled = !!sending;
    el.aiRetryBtn.disabled = !!sending;
    updateAIStatus();
  }

  function stopAIStream() {
    if (ui.aiThinkingTimer) {
      clearTimeout(ui.aiThinkingTimer);
      ui.aiThinkingTimer = null;
    }
    if (ui.aiRequestId) {
      if (platform && platform.ai) platform.ai.abort(ui.aiRequestId);
      ui.aiRequestId = '';
    }
    var thinking = el.aiAnswer.querySelector('.thinking');
    if (thinking) el.aiAnswer.textContent = ui.aiFullText || '已停止生成。';
    var caret = el.aiAnswer.querySelector('.caret');
    if (caret) caret.remove();
    ui.aiStreamNode = null;
    setAISending(false);
  }

  function appendAIDelta(text) {
    var follow = el.aiBody.scrollHeight - el.aiBody.scrollTop - el.aiBody.clientHeight < 100;
    if (!ui.aiStreamNode) {
      el.aiAnswer.textContent = '';
      ui.aiStreamNode = document.createTextNode('');
      var caret = document.createElement('span');
      caret.className = 'caret';
      el.aiAnswer.appendChild(ui.aiStreamNode);
      el.aiAnswer.appendChild(caret);
    }
    ui.aiFullText += text;
    ui.aiStreamNode.data = ui.aiFullText;
    if (follow) el.aiBody.scrollTop = el.aiBody.scrollHeight;
  }

  function finishAIStream(aborted) {
    if (ui.aiRequestId) ui.aiRequestId = '';
    var caret = el.aiAnswer.querySelector('.caret');
    if (caret) caret.remove();
    ui.aiStreamNode = null;
    setAISending(false);
    el.aiResultLabel.textContent = aborted ? '已停止' : '回答';
    if (aborted && !ui.aiFullText) el.aiAnswer.textContent = '已停止生成。';
    if (!el.aiAnswer.textContent.trim()) el.aiAnswer.textContent = '模型没有返回内容。';
  }

  function restoreAIComposerDraft() {
    var text = ui.aiLastRequest && ui.aiLastRequest.question || '';
    if (!text || ui.aiDraftEditedAfterSend || String(el.aiQuestion.value || '').trim()) return;
    el.aiQuestion.value = text;
    ui.aiComposer.suppressAutoFill = true;
  }

  function canRetryAI() {
    return !!ui.aiLastRequest && (!!ui.aiLastRequest.question || ui.aiLastRequest.contextMode !== 'none');
  }

  function failAIRequest(requestId, message) {
    if (ui.aiRequestId !== requestId) return;
    ui.aiRequestId = '';
    setAISending(false);
    el.aiResult.classList.add('is-error');
    el.aiResultLabel.textContent = '未能完成';
    el.aiAnswer.textContent = message || '请求失败，请检查网络与连接设置。';
    restoreAIComposerDraft();
  }

  function sendAI(retrySnapshot) {
    if (ui.aiRequestId) {
      stopAIStream();
      return;
    }
    var retry = retrySnapshot === true && canRetryAI();
    var question = retry ? ui.aiLastRequest.question : String(el.aiQuestion.value || '').trim();
    var contextMode = retry ? ui.aiLastRequest.contextMode
      : (ui.aiContext && ui.aiContext.type || 'none');
    if (!retry && (!ui.aiContext || ui.aiContext.type === 'none') && !question) {
      toast('先输入一个问题，或带上文字、截图', true);
      el.aiQuestion.focus();
      return;
    }
    if (!retry) {
      ui.aiLastRequest = {
        question: question,
        contextMode: contextMode
      };
      el.aiQuestion.value = '';
      ui.aiComposer.lastValue = '';
      ui.aiComposer.suppressAutoFill = true;
      ui.aiDraftEditedAfterSend = false;
    } else {
      ui.aiDraftEditedAfterSend = !!String(el.aiQuestion.value || '').trim();
    }
    resetAIResult();
    el.aiResult.hidden = false;
    el.aiEmpty.hidden = true;
    el.aiResultLabel.textContent = '正在回答';
    el.aiAnswer.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span>';
    setAISending(true);
    ui.aiFullText = '';
    var requestId = uid('req');
    ui.aiRequestId = requestId;
    ui.aiThinkingTimer = setTimeout(function () {
      ui.aiThinkingTimer = null;
      platform.ai.send({
        requestId: requestId,
        mode: 'editor',
        userContext: state.settings.ai.userContext || '',
        contextMode: contextMode,
        question: question
      }).then(function (result) {
        if (result && result.ok === false && ui.aiRequestId === requestId) {
          failAIRequest(requestId, result.error || '请求未发出，请检查连接设置。');
        }
      }).catch(function () {
        failAIRequest(requestId, '请求失败，稍后再试。');
      });
    }, 260);
  }
  /* ==================== 截图 ==================== */
  /* ==================== 截图 ==================== */
  /* 框选与裁剪在原生遮罩窗口里完成，这里只负责发起 */
  function startShot() {
    if (!platform || !platform.capture) return;
    closeMenus();
    hideSelectPill();
    platform.capture.shot().then(function (result) {
      if (result && result.ok === false) toast(result.error || '截图没有完成', true);
    }).catch(function () { toast('截图失败', true); });
  }

  /* ==================== 初始化与事件 ==================== */
  function isTypingTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function isAnyModalOpen() {
    return el.entryLayer.classList.contains('is-open') ||
      el.groupLayer.classList.contains('is-open') ||
      el.presetLayer.classList.contains('is-open') ||
      el.confirmLayer.classList.contains('is-open') ||
      (el.clipViewer && !el.clipViewer.hidden);
  }

  function handleEscape() {
    if (ui.recording) return;
    if (ui.shot.active) { cancelShot(); return; }
    if (el.confirmLayer.classList.contains('is-open')) { closeConfirm(false); return; }
    if (el.entryLayer.classList.contains('is-open')) { closeEntry(); return; }
    if (el.groupLayer.classList.contains('is-open')) { el.groupLayer.classList.remove('is-open'); return; }
    if (el.presetLayer.classList.contains('is-open')) { el.presetLayer.classList.remove('is-open'); return; }
    if (el.clipViewer && !el.clipViewer.hidden) { closeClipViewer(); return; }
    if (el.rowMenu.classList.contains('is-open') || el.trayMenu.classList.contains('is-open') || el.groupMenu.classList.contains('is-open')) {
      closeMenus();
      return;
    }
    if (isAIDialogOpen()) { closeAI(true); return; }
    if (isLauncherOpen()) { closeLauncher(true); return; }
    if (isAiHubOpen() || isClipWindowOpen() || isPetWindowOpen()) {
      openLauncher('function');
      return;
    }
    if (ui.page === 'settings') { closeSettings(); return; }
    if (document.activeElement === el.searchInput && el.searchInput.value) { clearSearch(); return; }
    if (isPanelVisible()) hidePanel(true);
  }

  function openAISettings() {
    closeAI(false);
    openSettings('ai');
  }

  function bindEvents() {
    /* 头部与窗口 */
    el.themeBtn.addEventListener('click', function () {
      var current = document.documentElement.dataset.theme;
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
    el.menuBtn.addEventListener('click', function () { openLauncher('panel'); });
    el.settingsBtn.addEventListener('click', function () { openSettings(''); });
    el.pinBtn.addEventListener('click', function () {
      state.settings.pin = !state.settings.pin;
      saveState();
      if (platform && platform.window) platform.window.setPin(state.settings.pin);
      updatePinUI();
      fillSettings();
      toast(state.settings.pin ? '已置顶' : '已取消置顶');
    });
    if (el.clipPinBtn) el.clipPinBtn.addEventListener('click', function () {
      state.settings.clipPin = !state.settings.clipPin;
      saveState();
      if (platform && platform.window && platform.window.setClipPin) {
        platform.window.setClipPin(state.settings.clipPin);
      }
      updatePinUI();
      toast(state.settings.clipPin ? '剪贴板窗口已置顶，粘贴后不会收起' : '已取消剪贴板置顶');
    });
    el.hideBtn.addEventListener('click', function () { hidePanel(true); });
    el.closeBtn.addEventListener('click', function () { hidePanel(true); });

    /* 搜索 */
    el.searchBox.addEventListener('click', function () { el.searchInput.focus(); });
    el.searchInput.addEventListener('focus', function () { el.searchBox.classList.add('is-focused'); });
    el.searchInput.addEventListener('blur', function () { el.searchBox.classList.remove('is-focused'); });
    el.searchInput.addEventListener('input', function () {
      ui.pendingQuery = el.searchInput.value;
      updateSearchUI();
      if (ui.pendingQuery === '') {
        ui.query = '';
        ui.focusIndex = 0;
        ui.listScrollReset = true;
        renderList();
      }
    });
    el.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (ui.pendingQuery !== ui.query) applySearch();
        else if (ui.viewItems.length) insertItem(ui.viewItems[ui.focusIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (el.searchInput.value) clearSearch();
        else el.searchInput.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(-1);
      }
    });
    el.searchClear.addEventListener('click', function (e) {
      e.stopPropagation();
      clearSearch();
    });

    /* 分组与列表 */
    var groupGesture = null;
    var blockGroupClick = false;

    function groupTabs() {
      return $$('.tab[data-group]', el.tabs).filter(function (tab) {
        return tab.dataset.group !== 'all';
      });
    }

    function stopGroupGesture() {
      if (groupGesture && groupGesture.timer) clearTimeout(groupGesture.timer);
      if (groupGesture && groupGesture.tab) groupGesture.tab.classList.remove('is-group-dragging');
      el.tabs.classList.remove('is-group-reordering');
      document.documentElement.classList.remove('is-group-reordering');
      groupGesture = null;
    }

    function finishGroupGesture(saveOrder) {
      if (!groupGesture) return;
      var wasActive = groupGesture.active;
      stopGroupGesture();
      if (!wasActive) return;
      blockGroupClick = true;
      setTimeout(function () { blockGroupClick = false; }, 0);
      if (!saveOrder) {
        renderTabs();
        return;
      }
      var ids = groupTabs().map(function (tab) { return tab.dataset.group; });
      var next = ids.map(function (id) {
        return state.groups.find(function (group) { return group.id === id; });
      }).filter(Boolean);
      state.groups.forEach(function (group) {
        if (!next.some(function (item) { return item.id === group.id; })) next.push(group);
      });
      var changed = next.some(function (group, index) { return group.id !== state.groups[index].id; });
      if (changed) {
        state.groups = next;
        saveState();
      }
      renderTabs();
    }

    function moveGroupTab(clientX) {
      if (!groupGesture || !groupGesture.tab) return;
      var tab = groupGesture.tab;
      var siblings = groupTabs().filter(function (item) { return item !== tab; });
      var before = null;
      for (var i = 0; i < siblings.length; i++) {
        var rect = siblings[i].getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          before = siblings[i];
          break;
        }
      }
      var add = el.tabs.querySelector('.tab-add');
      el.tabs.insertBefore(tab, before || add || null);
    }

    el.tabs.addEventListener('pointerdown', function (e) {
      var tab = e.target.closest('.tab[data-group]');
      if (!tab || tab.dataset.group === 'all' || e.button !== 0 || e.isPrimary === false) return;
      closeMenus();
      if (groupGesture) stopGroupGesture();
      var pointerId = e.pointerId;
      groupGesture = {
        tab: tab,
        pointerId: pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        timer: null
      };
      groupGesture.timer = setTimeout(function () {
        if (!groupGesture || groupGesture.pointerId !== pointerId) return;
        groupGesture.active = true;
        groupGesture.timer = null;
        tab.classList.add('is-group-dragging');
        el.tabs.classList.add('is-group-reordering');
        document.documentElement.classList.add('is-group-reordering');
        try { document.documentElement.setPointerCapture(pointerId); } catch (err) { /* ignore */ }
      }, 280);
    });

    document.addEventListener('pointermove', function (e) {
      if (!groupGesture || e.pointerId !== groupGesture.pointerId) return;
      var dx = e.clientX - groupGesture.startX;
      var dy = e.clientY - groupGesture.startY;
      if (!groupGesture.active) {
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) stopGroupGesture();
        return;
      }
      if (e.cancelable) e.preventDefault();
      moveGroupTab(e.clientX);
    }, { passive: false });

    document.addEventListener('pointerup', function (e) {
      if (!groupGesture || e.pointerId !== groupGesture.pointerId) return;
      finishGroupGesture(true);
    });

    document.addEventListener('pointercancel', function (e) {
      if (!groupGesture || e.pointerId !== groupGesture.pointerId) return;
      finishGroupGesture(false);
    });

    document.addEventListener('lostpointercapture', function (e) {
      if (!groupGesture || e.pointerId !== groupGesture.pointerId || !groupGesture.active) return;
      finishGroupGesture(false);
    });

    window.addEventListener('blur', function () {
      if (groupGesture) finishGroupGesture(false);
    });

    el.tabs.addEventListener('contextmenu', function (e) {
      var tab = e.target.closest('.tab[data-group]');
      if (!tab) return;
      e.preventDefault();
      if (groupGesture) finishGroupGesture(false);
      if (tab.dataset.group === 'all') {
        closeGroupMenu();
        return;
      }
      var group = state.groups.find(function (item) { return item.id === tab.dataset.group; });
      if (group) openGroupMenu(e, group);
    });

    el.groupMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-group-action]');
      if (!btn) return;
      var group = state.groups.find(function (item) { return item.id === el.groupMenu.dataset.groupId; });
      var action = btn.dataset.groupAction;
      closeGroupMenu();
      if (!group) return;
      if (action === 'rename') openGroupModal(group);
      else if (action === 'delete') deleteGroup(group);
    });

    el.tabs.addEventListener('click', function (e) {
      if (blockGroupClick) {
        blockGroupClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var add = e.target.closest('.tab-add');
      if (add) { openGroupModal(); return; }
      var tab = e.target.closest('.tab');
      if (!tab) return;
      ui.activeGroup = tab.dataset.group;
      ui.focusIndex = 0;
      ui.listScrollReset = true;
      renderTabs();
      renderList();
      updateSearchUI();
    });
    el.list.addEventListener('click', function (e) {
      var more = e.target.closest('.row-more');
      if (more) {
        e.stopPropagation();
        var mItem = state.items.find(function (it) { return it.id === more.dataset.more; });
        if (mItem) openRowMenu(more, mItem);
        return;
      }
      var row = e.target.closest('.row');
      if (!row) return;
      var item = state.items.find(function (it) { return it.id === row.dataset.id; });
      if (item) insertItem(item);
    });
    el.newItemBtn.addEventListener('click', function () { openEntry(null); });
    el.emptyNewBtn.addEventListener('click', function () { openEntry(null); });

    /* 独立启动器与功能窗口 */
    el.launcherClose.addEventListener('click', function () { closeLauncher(false); });
    el.launcherSettings.addEventListener('click', function () { openSettings(''); });
    el.launcherWindow.addEventListener('click', function (e) {
      var card = e.target.closest('[data-launch]');
      if (!card) return;
      var name = card.dataset.launch;
      if (name === 'main') showMainPanel();
      else openFunction(name);
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-manage-presets]')) { openFunction('aiPrefs'); return; }
      var newPreset = e.target.closest('[data-new-preset]');
      if (newPreset) { openAICustom(newPreset.dataset.newPreset); return; }
      var editPreset = e.target.closest('[data-edit-preset]');
      if (editPreset) { openAICustom(editPreset.dataset.editPreset, editPreset.dataset.presetId); return; }
      var usePreset = e.target.closest('[data-use-preset]');
      if (usePreset) {
        selectAIPreset(usePreset.dataset.usePreset, usePreset.dataset.presetId);
        saveState(); renderPresetLists(); renderAIChips(); renderAIPageSummary(); return;
      }
      var windowHideBtn = e.target.closest('[data-window-hide]');
      if (windowHideBtn) {
        if (platform && platform.window) platform.window.hide(VIEW);
        return;
      }
      var launcherBtn = e.target.closest('[data-launcher-open]');
      if (launcherBtn) { openLauncher('function'); return; }
      var viewerClose = e.target.closest('[data-close-clip-viewer]');
      if (viewerClose) { closeClipViewer(); return; }
      var close = e.target.closest('[data-close]');
      if (!close) return;
      var which = close.dataset.close;
      if (which === 'entry') closeEntry();
      else if (which === 'group') el.groupLayer.classList.remove('is-open');
      else if (which === 'preset') el.presetLayer.classList.remove('is-open');
      else if (which === 'confirm') closeConfirm(false);
    });
    el.aiPageSelect.addEventListener('click', function () { platform.capture.selection(); });
    el.aiPageShot.addEventListener('click', function () { startShot(); });
    el.aiPageSettings.addEventListener('click', function () { openSettings('ai'); });

    /* 设置页 */
    el.settingsBack.addEventListener('click', closeSettings);
    el.settingsDone.addEventListener('click', closeSettings);
    $$('.seg[data-seg]').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-value]');
        if (!btn) return;
        if (seg.dataset.seg === 'theme') setTheme(btn.dataset.value);
        else if (seg.dataset.seg === 'size') setPanelSize(btn.dataset.value);
      });
    });
    $$('.switch[data-setting]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.setting;
        state.settings[key] = !state.settings[key];
        if (key === 'pin' && platform && platform.window) {
          platform.window.setPin(state.settings.pin);
        }
        saveState();
        fillSettings();
        if (key === 'pin') toast(state.settings.pin ? '已置顶' : '已取消置顶');
        if (key === 'clipboardWatch') {
          if (state.settings.clipboardWatch) {
            clipPollDenied = false;
            startClipPolling();
          } else {
            stopClipPolling();
          }
          updateClipStatus();
        }
      });
    });
    $$('.hotkey-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startRecording(btn, btn.dataset.hotkey);
      });
    });

    var aiSave = debounce(saveState, 320);
    if (el.aiHubUserContext) {
      el.aiHubUserContext.addEventListener('input', function () {
        state.settings.ai.userContext = el.aiHubUserContext.value;
        aiSave();
      });
    }
    el.aiUserContextInput.addEventListener('input', function () {
      state.settings.ai.userContext = el.aiUserContextInput.value;
      aiSave();
    });
    el.aiPrefNewPrompt.addEventListener('click', function () { openAIPrefPrompt(''); });
    el.aiPrefPromptCancel.addEventListener('click', function () { el.aiPrefPromptEditor.hidden = true; });
    el.aiPrefPromptEditor.addEventListener('submit', function (e) {
      e.preventDefault();
      saveAIPrefPrompt();
    });
    el.aiPrefPromptList.addEventListener('click', async function (e) {
      var use = e.target.closest('[data-ai-pref-prompt-use]');
      if (use) {
        state.settings.promptId = use.dataset.aiPrefPromptUse;
        saveState();
        renderAIPrefsSettings();
        renderAIChips();
        renderAIPageSummary();
        return;
      }
      var edit = e.target.closest('[data-ai-pref-prompt-edit]');
      if (edit) { openAIPrefPrompt(edit.dataset.aiPrefPromptEdit); return; }
      var del = e.target.closest('[data-ai-pref-prompt-delete]');
      if (!del) return;
      var id = del.dataset.aiPrefPromptDelete;
      var prompt = state.prompts.find(function (item) { return item.id === id; });
      if (!prompt) return;
      var ok = await askConfirm({
        title: '删除提示词',
        message: '确定删除「' + prompt.name + '」吗？',
        okText: '删除'
      });
      if (!ok) return;
      state.prompts = state.prompts.filter(function (item) { return item.id !== id; });
      if (state.settings.promptId === id) state.settings.promptId = state.prompts[0] ? state.prompts[0].id : '';
      saveState();
      renderAIPrefsSettings();
      renderAIChips();
      renderAIPageSummary();
    });
    [['aiBaseUrl', 'baseUrl'], ['aiApiKey', 'apiKey'], ['aiModel', 'model']].forEach(function (pair) {
      el[pair[0]].addEventListener('input', function () {
        state.settings.ai[pair[1]] = el[pair[0]].value;
        state.settings.ai.connection = null;
        if (pair[1] === 'model') {
          var selected = (state.settings.ai.availableModels || []).find(function (model) { return model.id === el.aiModel.value; });
          state.settings.ai.supportsImages = selected ? selected.supportsImages : null;
        }
        aiSave();
        updateAIStatus();
        renderAIPageSummary();
      });
    });
    el.apiKeyEye.addEventListener('click', function () {
      var showing = el.aiApiKey.type === 'text';
      el.aiApiKey.type = showing ? 'password' : 'text';
      el.apiKeyEye.innerHTML = icon(showing ? 'eye' : 'eye-off');
    });
    el.testApiBtn.addEventListener('click', testAIConnection);
    el.managePresetsBtn.addEventListener('click', function () { openFunction('aiPrefs'); });
    el.exportBtn.addEventListener('click', exportData);
    el.importBtn.addEventListener('click', function () { importData(); });
    el.importFile.addEventListener('change', function () {
      if (el.importFile.files && el.importFile.files[0]) importData(el.importFile.files[0]);
      el.importFile.value = '';
    });
    el.resetBtn.addEventListener('click', resetAll);

    /* 剪贴板记录 */
    el.clipSearch.addEventListener('input', renderClipList);
    el.clipReadBtn.addEventListener('click', readClipboardNow);
    el.clipClearBtn.addEventListener('click', clearClipboardHistory);
    el.clipList.addEventListener('pointerover', function (e) {
      var row = e.target.closest('.clip-item');
      clipHoverId = row ? row.dataset.clipId : null;
    });
    el.clipList.addEventListener('pointerleave', function () { clipHoverId = null; });
    el.clipList.addEventListener('click', async function (e) {
      var actionBtn = e.target.closest('[data-clip-action]');
      if (!actionBtn) return;
      var entry = state.clipboard.find(function (item) { return item.id === actionBtn.dataset.clipId; });
      if (!entry) return;
      var action = actionBtn.dataset.clipAction;
      if (action === 'copy') copyClipboardEntry(entry);
      else if (action === 'paste') pasteClipboardEntry(entry);
      else if (action === 'view') openClipViewer(entry);
      else if (action === 'delete') {
        var result = await platform.clipboard.remove(entry.id);
        if (!result || !result.ok) { toast('删除失败，请重试', true); return; }
        state.clipboard = state.clipboard.filter(function (item) { return item.id !== entry.id; });
        renderClipList();
        updateClipStatus();
        if (ui.clipViewerId === entry.id) closeClipViewer();
        toast('已删除这条记录');
      }
    });
    el.clipViewerCopy.addEventListener('click', function () {
      var entry = state.clipboard.find(function (item) { return item.id === ui.clipViewerId; });
      if (entry) copyClipboardEntry(entry);
    });
    el.clipViewerPaste.addEventListener('click', function () {
      var entry = state.clipboard.find(function (item) { return item.id === ui.clipViewerId; });
      if (entry) pasteClipboardEntry(entry);
    });
    el.clipViewerControls.addEventListener('click', function (e) {
      var action = e.target.closest('[data-clip-viewer-zoom]');
      if (!action) return;
      var kind = action.dataset.clipViewerZoom;
      if (kind === 'in') setClipViewerZoom(ui.clipViewerZoom + 0.25);
      else if (kind === 'out') setClipViewerZoom(ui.clipViewerZoom - 0.25);
      else if (kind === 'fit') setClipViewerZoom(1);
    });
    el.clipViewerImg.addEventListener('load', function () {
      if (el.clipViewer.classList.contains('is-image') && !el.clipViewer.hidden) applyClipViewerZoom();
    });
    window.addEventListener('resize', function () {
      if (el.clipViewer.classList.contains('is-image') && !el.clipViewer.hidden) applyClipViewerZoom();
    });

    document.addEventListener('copy', function (e) {
      if (!e.clipboardData) return;
      var text = e.clipboardData.getData('text/plain');
      if (text) recordClipboard('text', text, '复制');
    });
    document.addEventListener('cut', function (e) {
      if (!e.clipboardData) return;
      var text = e.clipboardData.getData('text/plain');
      if (text) recordClipboard('text', text, '剪切');
    });
    document.addEventListener('paste', function (e) {
      if (!e.clipboardData) return;
      var text = e.clipboardData.getData('text/plain');
      if (text) recordClipboard('text', text, '粘贴');
      var items = e.clipboardData.items;
      if (!items) return;
      var imageItem = Array.from(items).find(function (it) { return /^image\//.test(it.type); });
      if (!imageItem) return;
      var file = imageItem.getAsFile();
      if (!file) return;
      fileToDataURL(file).then(function (data) {
        recordClipboard('image', '', '粘贴', data);
      }).catch(function () { /* ignore */ });
    });

    /* 面板自由缩放：八向拖拽（边、角都行），窗口跟着一起变 */
    var resizeState = null;
    var SHELL_MARGIN = 60; /* 窗口 = 面板 + 左右/上下各 30px 透明边距 */

    function resizeLimits() {
      var availW = (window.screen && screen.availWidth) || innerWidth;
      var availH = (window.screen && screen.availHeight) || innerHeight;
      var maxW = Math.max(360, Math.min(1120, availW - 80));
      var maxH = Math.max(320, Math.min(920, availH - 80));
      return {
        minW: Math.min(VIEW === 'panel' ? 480 : 360, maxW),
        minH: Math.min(VIEW === 'panel' ? 420 : 300, maxH),
        maxW: maxW,
        maxH: maxH,
        availW: availW,
        availH: availH,
        availX: (window.screen && Number.isFinite(screen.availLeft)) ? screen.availLeft : 0,
        availY: (window.screen && Number.isFinite(screen.availTop)) ? screen.availTop : 0
      };
    }

    function startResize(dir, e, captureTarget) {
      if (windowGesture || resizeState || e.button !== 0 || e.isPrimary === false) return;
      if (document.documentElement.classList.contains('is-window-dragging')) return;
      e.preventDefault();
      e.stopPropagation();
      windowGesture = 'resize';
      var root = activeWindowElement();
      if (!root) { windowGesture = null; return; }
      var rect = root.getBoundingClientRect();
      var handle = captureTarget || e.currentTarget;
      var shell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-margin')) || 0;
      var outerWidth = window.outerWidth || innerWidth;
      var outerHeight = window.outerHeight || innerHeight;
      resizeState = {
        pointerId: e.pointerId,
        dir: dir,
        startX: e.screenX,
        startY: e.screenY,
        winX: window.screenX,
        winY: window.screenY,
        startW: rect.width,
        startH: rect.height,
        marginW: outerWidth > rect.width ? outerWidth - rect.width : shell * 2,
        marginH: outerHeight > rect.height ? outerHeight - rect.height : shell * 2,
        w: rect.width,
        h: rect.height,
        x: window.screenX,
        y: window.screenY,
        lastSync: 0,
        root: root,
        handle: handle,
        userSelect: document.body.style.userSelect
      };
      root.classList.add('is-resizing');
      document.body.style.userSelect = 'none';
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    function moveResize(e) {
      if (windowGesture !== 'resize' || !resizeState || e.pointerId !== resizeState.pointerId) return;
      var st = resizeState;
      var dx = e.screenX - st.startX;
      var dy = e.screenY - st.startY;
      var L = resizeLimits();
      var w = st.startW;
      var h = st.startH;
      var x = st.winX;
      var y = st.winY;

      if (st.dir.indexOf('e') >= 0) w = clamp(st.startW + dx, L.minW, L.maxW);
      if (st.dir.indexOf('w') >= 0) {
        w = clamp(st.startW - dx, L.minW, L.maxW);
        x = st.winX + (st.startW - w);
      }
      if (st.dir.indexOf('s') >= 0) h = clamp(st.startH + dy, L.minH, L.maxH);
      if (st.dir.indexOf('n') >= 0) {
        h = clamp(st.startH - dy, L.minH, L.maxH);
        y = st.winY + (st.startH - h);
      }

      /* 别把窗口拖出屏幕 */
      x = clamp(x, L.availX, L.availX + L.availW - (w + st.marginW));
      y = clamp(y, L.availY, L.availY + L.availH - (h + st.marginH));

      st.w = w;
      st.h = h;
      st.x = x;
      st.y = y;
      if (VIEW === 'panel') {
        el.panel.style.setProperty('--panel-w', Math.round(w) + 'px');
        el.panel.style.setProperty('--panel-h', Math.round(h) + 'px');
        if (el.panelSizeNow) el.panelSizeNow.textContent = ' 当前 ' + Math.round(w) + ' × ' + Math.round(h) + '。';
      }

      /* 窗口本身也要跟着变，否则面板会被裁掉；节流到 ~24ms 一次 */
      var now = Date.now();
      if (!st.lastSync || now - st.lastSync > 24) {
        st.lastSync = now;
        if (VIEW === 'panel' && platform && platform.window && platform.window.resizePanelLive) {
          platform.window.resizePanelLive(Math.round(w) + SHELL_MARGIN, Math.round(h) + SHELL_MARGIN, Math.round(x), Math.round(y));
        } else if (VIEW !== 'panel' && platform && platform.window && platform.window.resizeWindowLive) {
          platform.window.resizeWindowLive(Math.round(w + st.marginW), Math.round(h + st.marginH), Math.round(x), Math.round(y));
        }
      }
    }

    function finishResize(e) {
      if (!resizeState) return;
      if (e && e.pointerId !== resizeState.pointerId) return;
      if (e && e.type === 'pointerup') moveResize(e);
      var st = resizeState;
      var w = Math.round(st.w);
      var h = Math.round(st.h);
      resizeState = null;
      windowGesture = null;
      st.root.classList.remove('is-resizing');
      document.body.style.userSelect = st.userSelect;
      try { st.handle.releasePointerCapture(st.pointerId); } catch (err) { /* 已失去捕获时无需释放 */ }
      if (VIEW === 'panel') {
        state.settings.panelSize = 'custom';
        state.settings.panelW = w;
        state.settings.panelH = h;
        applyPanelSize('custom');
      }
      if (VIEW === 'panel' && platform && platform.window && platform.window.resizePanel) {
        /* 最后一次尺寸和位置一起提交；由主进程保存面板尺寸，避免重复保存触发居中。 */
        platform.window.resizePanel(w, h, Math.round(st.x), Math.round(st.y));
      } else if (VIEW !== 'panel' && platform && platform.window && platform.window.resizeWindow) {
        platform.window.resizeWindow(
          Math.round(w + st.marginW),
          Math.round(h + st.marginH),
          Math.round(st.x),
          Math.round(st.y)
        );
      } else if (VIEW === 'panel') saveState();
    }

    beginPanelResize = startResize;
    $$('.rz').forEach(function (handle) {
      handle.addEventListener('pointerdown', function (e) { startResize(handle.dataset.dir || '', e); });
    });
    /* 右下角的小抓手沿用同一套逻辑 */
    el.resizeGrip.addEventListener('pointerdown', function (e) { startResize('se', e); });
    document.addEventListener('pointermove', moveResize, true);
    document.addEventListener('pointerup', finishResize, true);
    document.addEventListener('pointercancel', finishResize, true);
    document.addEventListener('lostpointercapture', finishResize, true);
    window.addEventListener('blur', function () { finishResize(); });

    /* 词条编辑 */
    el.entryTypeSeg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (btn) setEntryType(btn.dataset.type);
    });
    el.entryFile.addEventListener('change', function () {
      if (el.entryFile.files && el.entryFile.files[0]) loadEntryImage(el.entryFile.files[0]);
    });
    el.dropzone.addEventListener('click', function () { el.entryFile.click(); });
    el.dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      el.dropzone.classList.add('is-drag');
    });
    el.dropzone.addEventListener('dragleave', function () {
      el.dropzone.classList.remove('is-drag');
    });
    el.dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      el.dropzone.classList.remove('is-drag');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) loadEntryImage(e.dataTransfer.files[0]);
    });
    el.entrySave.addEventListener('click', saveEntry);
    el.entryTitleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveEntry(); }
    });
    document.addEventListener('paste', function (e) {
      if (!el.entryLayer.classList.contains('is-open')) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var imageItem = Array.from(items).find(function (it) { return /^image\//.test(it.type); });
      if (!imageItem) return;
      e.preventDefault();
      var file = imageItem.getAsFile();
      if (file) loadEntryImage(file);
    });

    /* 分组弹窗 */
    el.groupSave.addEventListener('click', saveGroup);
    el.groupNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveGroup(); }
    });

    /* 预设弹窗 */
    el.presetEditor.addEventListener('submit', function (e) { e.preventDefault(); saveAICustom(); });
    el.presetEditorCancel.addEventListener('click', function () { el.presetEditor.hidden = true; ui.aiCustomKind = null; });
    el.loadModelsBtn.addEventListener('click', loadAIModels);
    el.presetLayer.addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add) { addPreset(add.dataset.add); return; }
      var del = e.target.closest('[data-del-kind]');
      if (del) {
        var kind = del.dataset.delKind;
        var id = del.dataset.delId;
        var list = kind === 'persona' ? state.personas : state.prompts;
        var index = list.findIndex(function (p) { return p.id === id; });
        if (index < 0) return;
        var removed = list[index];
        list.splice(index, 1);
        var replacement = null;
        if (kind === 'persona' && state.settings.personaId === id) {
          state.settings.personaId = state.personas[0] ? state.personas[0].id : '';
          replacement = getPersona();
        }
        if (kind === 'prompt' && state.settings.promptId === id) {
          state.settings.promptId = state.prompts[0] ? state.prompts[0].id : '';
          replacement = getPrompt();
        }
        saveState();
        if (replacement && VIEW === 'aiDialog') updateAIComposerPreset(kind, removed, replacement);
        syncAIComposerIfPristine();
        renderPresetLists();
        renderAIChips();
        renderAIPageSummary();
        toast('预设已删除');
      }
    });
    [['personaAddInput', 'persona'], ['promptAddInput', 'prompt']].forEach(function (pair) {
      el[pair[0]].addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addPreset(pair[1]); }
      });
    });

    /* 确认框 */
    el.confirmOk.addEventListener('click', function () { closeConfirm(true); });
    el.confirmCancel.addEventListener('click', function () { closeConfirm(false); });

    /* AI 窗口 */
    el.aiCloseBtn.addEventListener('click', function () { closeAI(false); });
    el.aiSettingsBtn.addEventListener('click', openAISettings);
    el.aiFootSettings.addEventListener('click', openAISettings);
    el.aiContextClear.addEventListener('click', function () { ui.aiContext = { type: 'none' }; populateAIContext(); });
    el.aiDialogSelect.addEventListener('click', function () { platform.capture.selection(); });
    el.aiDialogShot.addEventListener('click', startShot);
    el.aiCtxThumb.addEventListener('click', function () { if (ui.aiContext && ui.aiContext.type === 'image') openClipViewer({ id: '', type: 'image', image: ui.aiContext.url, createdAt: Date.now(), source: '当前截图' }); });
    el.aiPageChat.addEventListener('click', function () {
      platform.nav.open('aiDialog', { question: el.aiHubQuestion.value.trim(), from: 'aiHub' });
    });
    el.aiHubQuestion.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.aiPageChat.click(); } });
    el.aiExpand.addEventListener('click', function () {
      var expanded = el.aiCtxText.classList.toggle('is-expanded');
      el.aiExpand.textContent = expanded ? '收起' : '展开';
    });
    el.personaChips.addEventListener('click', function (e) {
      if (e.target.closest('[data-add-persona]')) { openAICustom('persona'); return; }
      var chip = e.target.closest('[data-persona]');
      if (!chip) return;
      selectAIPreset('persona', chip.dataset.persona);
      saveState();
      ui.aiCustomKind = null;
      renderAIChips();
      renderAIPageSummary();
    });
    el.promptChips.addEventListener('click', function (e) {
      if (e.target.closest('[data-add-prompt]')) { openFunction('aiPrefs'); return; }
      var chip = e.target.closest('[data-prompt]');
      if (!chip) return;
      selectAIPreset('prompt', chip.dataset.prompt);
      saveState();
      ui.aiCustomKind = null;
      renderAIChips();
      renderAIPageSummary();
    });
    el.aiSendBtn.addEventListener('click', function () { sendAI(false); });
    el.aiQuestion.addEventListener('input', function () {
      ui.aiComposer.suppressAutoFill = true;
      if (ui.aiRequestId || ui.aiThinkingTimer) ui.aiDraftEditedAfterSend = true;
    });
    el.aiQuestion.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (ui.aiRequestId || ui.aiThinkingTimer) stopAIStream();
        else sendAI(false);
      }
    });
    el.aiCopyBtn.addEventListener('click', async function () {
      var text = ui.aiFullText || el.aiAnswer.textContent || '';
      if (!text) return;
      var ok = await copyText(text);
      toast(ok ? '结果已复制' : '复制失败，请手动选择文字', !ok);
    });
    el.aiRetryBtn.addEventListener('click', function () {
      if (canRetryAI()) sendAI(true);
    });

    /* AI 窗口拖动 */
    var dragState = null;
    el.aiDrag.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      var rect = el.aiWindow.getBoundingClientRect();
      dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      el.aiWindow.classList.add('is-dragging');
      try { el.aiDrag.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.aiDrag.addEventListener('pointermove', function (e) {
      if (!dragState) return;
      var w = el.aiWindow.offsetWidth;
      var left = clamp(e.clientX - dragState.dx, 8, innerWidth - w - 8);
      var top = clamp(e.clientY - dragState.dy, 8, innerHeight - 60);
      el.aiWindow.style.left = left + 'px';
      el.aiWindow.style.top = top + 'px';
    });
    function endDrag() {
      dragState = null;
      el.aiWindow.classList.remove('is-dragging');
    }
    el.aiDrag.addEventListener('pointerup', endDrag);
    el.aiDrag.addEventListener('pointercancel', endDrag);

    /* 划词气泡 */
    document.addEventListener('mouseup', function (e) {
      if (e.target.closest('#panel, #aiWindow, #launcherWindow, #aiHubWindow, #clipWindow, #petWindow, #shotLayer, #trayBtn, #rowMenu, #trayMenu, #selectPill')) return;
      setTimeout(function () {
        var text = getSelectedText();
        if (!text) { hideSelectPill(); return; }
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) { hideSelectPill(); return; }
        var node = sel.anchorNode;
        var anchor = node && node.nodeType === 3 ? node.parentElement : node;
        if (!anchor || !anchor.closest('[data-selectable]')) { hideSelectPill(); return; }
        var rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) { hideSelectPill(); return; }
        showSelectPill(rect, text);
      }, 12);
    });
    el.selectPill.addEventListener('click', function () {
      var text = ui.pendingSelection || getSelectedText();
      hideSelectPill();
      if (text) openAIText(text);
    });

    /* 截图 */
    el.shotLayer.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.shot-bar')) return;
      if (e.button !== undefined && e.button !== 0) return;
      ui.shot.dragging = true;
      ui.shot.start = { x: e.clientX, y: e.clientY };
      ui.shot.rect = null;
      el.shotBox.hidden = false;
      el.shotBar.hidden = true;
      el.shotLayer.classList.add('has-box');
      updateShotBox(e.clientX, e.clientY);
      try { el.shotLayer.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.shotLayer.addEventListener('pointermove', function (e) {
      if (!ui.shot.dragging) return;
      updateShotBox(e.clientX, e.clientY);
    });
    el.shotLayer.addEventListener('pointerup', function () {
      if (!ui.shot.dragging) return;
      ui.shot.dragging = false;
      var rect = ui.shot.rect;
      if (!rect || rect.w < 10 || rect.h < 10) {
        resetShotSelection();
        return;
      }
      positionShotBar(rect);
    });
    el.shotRetryBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      resetShotSelection();
    });
    el.shotConfirmBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      confirmShot();
    });

    /* 托盘 */
    el.trayBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (el.trayMenu.classList.contains('is-open')) closeTrayMenu();
      else openTrayMenu();
    });
    el.trayMenu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-tray]');
      if (!item) return;
      var action = item.dataset.tray;
      closeTrayMenu();
      if (action === 'launcher') openLauncher('tray');
      else if (action === 'open') showMainPanel();
      else if (action === 'select') triggerSelectAI(true);
      else if (action === 'shot') startShot();
      else if (action === 'settings') openSettings('');
      else if (action === 'quit') toast('浏览器原型不会退出；Electron 版会结束进程并清理托盘');
    });

    /* 词条更多菜单 */
    el.rowMenu.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-row-action]');
      if (!btn) return;
      var id = el.rowMenu.dataset.itemId;
      var item = state.items.find(function (it) { return it.id === id; });
      var action = btn.dataset.rowAction;
      closeRowMenu();
      if (!item) return;
      if (action === 'edit') {
        openEntry(item);
      } else if (action === 'copy') {
        var ok;
        if (item.type === 'image') {
          var prepared = await ensureClipboardImage(item);
          var copied = prepared ? await platform.snippet.copy(item.id) : { ok: false };
          ok = !!(copied && copied.ok !== false);
          toast(ok ? '图片已复制到剪贴板' : '图片复制失败', !ok);
        } else {
          ok = await copyText(item.content);
          toast(ok ? '内容已复制' : '复制失败', !ok);
        }
      } else if (action === 'delete') {
        var confirmed = await askConfirm({
          title: '删除词条',
          message: '「' + item.title + '」会从本机删除，不能恢复。',
          okText: '删除'
        });
        if (!confirmed) return;
        state.items = state.items.filter(function (it) { return it.id !== item.id; });
        saveState();
        ui.listScrollReset = true;
        renderTabs();
        renderList();
        toast('词条已删除');
      }
    });

    /* 点击空白关闭菜单与气泡 */
    document.addEventListener('mousedown', function (e) {
      if (isLauncherOpen() && !e.target.closest('#launcherWindow')) {
        closeLauncher(true);
      }
      if (e.target.closest('.menu, #trayBtn, #menuBtn, #selectPill, #launcherWindow')) return;
      closeMenus();
      hideSelectPill();
    });
    window.addEventListener('scroll', hideSelectPill, true);
    window.addEventListener('resize', function () {
      closeMenus();
      hideSelectPill();
    });

    /* 模拟聊天窗口 */
    el.mockSend.addEventListener('click', function () {
      var text = el.mockInput.textContent.trim();
      if (!text) { toast('先输入点内容', true); return; }
      var row = document.createElement('div');
      row.className = 'chat-row right';
      var bubble = document.createElement('div');
      bubble.className = 'bubble me';
      bubble.textContent = text;
      row.appendChild(bubble);
      el.mockChat.appendChild(row);
      el.mockInput.textContent = '';
      el.mockChat.scrollTop = el.mockChat.scrollHeight;
    });
    el.mockInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        el.mockSend.click();
      }
    });

    /* 本地按键：列表导航、搜索、Esc；全局快捷键由主进程统一注册 */
    document.addEventListener('keydown', function (e) {
      if (ui.recording) return;
      var hk = state.settings.hotkeys;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscape();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (!isPanelVisible() || ui.page !== 'main') return;

      if (matchHotkey(e, hk.up)) {
        e.preventDefault();
        moveFocus(-1);
        return;
      }
      if (matchHotkey(e, hk.down)) {
        e.preventDefault();
        moveFocus(1);
        return;
      }
      if (matchHotkey(e, hk.paste)) {
        if (ui.viewItems.length) {
          e.preventDefault();
          insertItem(ui.viewItems[ui.focusIndex]);
        }
        return;
      }
      if (matchHotkey(e, hk.search)) {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
      }
    });

    /* 系统主题变化 */
    var mq = matchMedia('(prefers-color-scheme: light)');
    var onSchemeChange = function () {
      if (state.settings.theme === 'auto') applyTheme('auto', true);
    };
    if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
    else if (mq.addListener) mq.addListener(onSchemeChange);
  }

  /* ==================== 桌宠设置 ==================== */
  var petDraft = { avatarPath: '', avatarName: '', audioPaths: [], audioNames: [] };
  var petPreviewAudio = null;

  function petEnabled() { return !!state.settings.petEnabled; }
  function petPaused() { return !!state.settings.petPaused; }

  function renderPetSettings() {
    if (VIEW !== 'petSettings') return;
    renderPetToolbar();
    renderPetList();
    renderPetSceneList();
  }

  function renderPetToolbar() {
    var master = document.getElementById('petMasterBtn');
    var pause = document.getElementById('petPauseBtn');
    if (master) {
      master.textContent = petEnabled() ? '隐藏桌宠' : '显示桌宠';
      master.classList.toggle('is-primary', petEnabled());
    }
    if (pause) {
      pause.textContent = petPaused() ? '恢复接话' : '暂停接话';
      pause.classList.toggle('danger', petPaused());
    }
  }

  function petById(id) {
    return (state.pets || []).find(function (pet) { return pet.id === id; }) || null;
  }

  function renderPetList() {
    var list = document.getElementById('petList');
    if (!list) return;
    var pets = state.pets || [];
    if (!pets.length) {
      list.innerHTML = '<div class="pet-empty-line">还没有桌宠，去「添加」选一张头像和一段录音。</div>';
      return;
    }
    list.innerHTML = pets.map(function (pet) {
      var avatar = pet.avatarUrl || pet.avatar || '';
      var count = (pet.clips || []).filter(function (clip) { return clip.enabled; }).length;
      var on = pet.enabled !== false;
      return '<div class="pet-card" data-pet-id="' + esc(pet.id) + '">' +
        '<img class="pet-card-avatar" src="' + esc(avatar) + '" alt="">' +
        '<div class="pet-card-main">' +
          '<div class="pet-card-name">' + esc(pet.name) +
            '<span class="pet-badge' + (on ? '' : ' is-off') + '">' + (on ? '已启用' : '已停用') + '</span>' +
            (pet.builtin ? '<span class="pet-badge is-off">内置</span>' : '<span class="pet-badge">DIY</span>') +
          '</div>' +
          '<div class="pet-card-sub">' + count + ' 段台词 · ' + Math.round(pet.size || 196) + ' px</div>' +
        '</div>' +
        '<div class="pet-card-actions">' +
          '<button class="pet-mini" type="button" data-pet-action="toggle" data-pet-id="' + esc(pet.id) + '">' + (on ? '停用' : '启用') + '</button>' +
          '<button class="pet-mini" type="button" data-pet-action="test" data-pet-id="' + esc(pet.id) + '">试听</button>' +
          '<button class="pet-mini" type="button" data-pet-action="smaller" data-pet-id="' + esc(pet.id) + '">缩小</button>' +
          '<button class="pet-mini" type="button" data-pet-action="bigger" data-pet-id="' + esc(pet.id) + '">放大</button>' +
          (pet.builtin ? '' : '<button class="pet-mini danger" type="button" data-pet-action="delete" data-pet-id="' + esc(pet.id) + '">删除</button>') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function petStepRow(step, index) {
    var pets = state.pets || [];
    var pet = petById(step.petId);
    var clips = pet ? (pet.clips || []) : [];
    var petOptions = pets.map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (item.id === step.petId ? ' selected' : '') + '>' + esc(item.name) + '</option>';
    }).join('');
    var clipOptions = '<option value="">随机一句</option>' + clips.map(function (clip) {
      return '<option value="' + clip.id + '"' + (Number(step.clipId) === clip.id ? ' selected' : '') + '>' + esc(shorten(clip.label || '第 ' + clip.id + ' 段', 14)) + '</option>';
    }).join('');
    return '<div class="pet-step" data-step-index="' + index + '">' +
      '<span class="pet-step-index">' + (index + 1) + '</span>' +
      '<select data-step-field="petId">' + petOptions + '</select>' +
      '<select data-step-field="clipId">' + clipOptions + '</select>' +
      '<span class="pet-step-label">间隔</span>' +
      '<input type="number" min="0" max="60" step="0.2" data-step-field="delay" value="' + ((Number(step.delayMs) || 0) / 1000).toFixed(1) + '">' +
      '<span class="pet-step-label">秒</span>' +
      '<div class="pet-step-actions">' +
        '<button class="pet-mini" type="button" data-step-action="up">↑</button>' +
        '<button class="pet-mini" type="button" data-step-action="down">↓</button>' +
        '<button class="pet-mini danger" type="button" data-step-action="delete">删</button>' +
      '</div>' +
    '</div>';
  }

  function currentScenes() {
    if (!Array.isArray(state.replyScenes)) state.replyScenes = [];
    return state.replyScenes;
  }

  function petSceneById(id) {
    return currentScenes().find(function (scene) { return scene.id === id; }) || null;
  }

  function petSceneCard(scene, index, open) {
    var steps = scene.steps || [];
    var starter = steps.length ? petById(steps[0].petId) : null;
    var enabled = scene.enabled !== false;
    var meta = starter
      ? '点 ' + esc(starter.name) + ' 开始 · ' + steps.length + ' 句'
      : '还没有设置第一句';
    var body = open
      ? '<div class="pet-scene-body">' +
          '<div class="pet-add-row pet-scene-name-row">' +
            '<span class="field-label">名称</span>' +
            '<input class="field" type="text" maxlength="60" data-scene-name value="' + esc(scene.name || '') + '" placeholder="给这套接话起个名字" autocomplete="off">' +
          '</div>' +
          (steps.length
            ? '<div class="pet-step-list">' + steps.map(function (step, stepIndex) {
                return petStepRow(step, stepIndex);
              }).join('') + '</div>'
            : '<div class="pet-empty-line">这套接话还没有台词。加一句，安排谁先说。</div>') +
          '<div class="pet-scene-foot">' +
            '<button class="pet-mini" type="button" data-scene-action="add-step">加一句</button>' +
            '<span>第一句换成谁，就用谁点击触发</span>' +
          '</div>' +
        '</div>'
      : '';
    return '<article class="pet-scene' + (open ? ' is-open' : '') + (enabled ? '' : ' is-disabled') + '" data-scene-id="' + esc(scene.id) + '">' +
      '<div class="pet-scene-head">' +
        '<button class="pet-scene-summary" type="button" data-scene-action="toggle" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<span class="pet-scene-caret">›</span>' +
          '<span class="pet-scene-copy">' +
            '<span class="pet-scene-name">' + esc(scene.name || ('接话 ' + (index + 1))) + '</span>' +
            '<span class="pet-scene-meta">' + meta + '</span>' +
          '</span>' +
        '</button>' +
        '<label class="pet-scene-enable">' +
          '<input type="checkbox" data-scene-enabled' + (enabled ? ' checked' : '') + '>' +
          '<span>启用</span>' +
        '</label>' +
        '<button class="pet-mini danger" type="button" data-scene-action="delete">删除</button>' +
      '</div>' +
      body +
    '</article>';
  }

  function renderPetSceneList() {
    var list = document.getElementById('petSceneList');
    if (!list) return;
    var scenes = currentScenes();
    if (ui.petSceneId === undefined) {
      ui.petSceneId = scenes[0] ? scenes[0].id : null;
    } else if (ui.petSceneId && !scenes.some(function (scene) { return scene.id === ui.petSceneId; })) {
      ui.petSceneId = scenes[0] ? scenes[0].id : null;
    }
    if (!scenes.length) {
      list.innerHTML = '<div class="pet-empty-line">还没有接话小剧场。新建一套，安排谁先说、谁后说。</div>';
      return;
    }
    list.innerHTML = scenes.map(function (scene, index) {
      return petSceneCard(scene, index, scene.id === ui.petSceneId);
    }).join('');
  }

  function addPetScene() {
    var first = (state.pets || [])[0];
    if (!first) {
      toast('先添加一只桌宠', true);
      return;
    }
    var scenes = currentScenes();
    var scene = {
      id: uid('scene'),
      name: '接话 ' + (scenes.length + 1),
      enabled: true,
      steps: [{ petId: first.id, mode: 'random', clipId: null, delayMs: 0 }]
    };
    scenes.push(scene);
    ui.petSceneId = scene.id;
    saveState();
    renderPetSceneList();
    toast('已新建一套接话，第一句的桌宠就是触发人');
  }

  async function deletePetScene(sceneId) {
    var scene = petSceneById(sceneId);
    if (!scene) return;
    var confirmed = await askConfirm({
      title: '删除接话小剧场',
      message: '「' + (scene.name || '未命名接话') + '」的顺序会从本机删除，不能恢复。',
      okText: '删除'
    });
    if (!confirmed) return;
    var scenes = currentScenes();
    var index = scenes.findIndex(function (item) { return item.id === sceneId; });
    if (index >= 0) scenes.splice(index, 1);
    if (ui.petSceneId === sceneId) ui.petSceneId = scenes[0] ? scenes[0].id : null;
    saveState();
    renderPetSceneList();
    toast('接话小剧场已删除');
  }

  function mutateSceneStep(sceneId, index, patch) {
    var scene = petSceneById(sceneId);
    var step = scene && scene.steps ? scene.steps[index] : null;
    if (!step) return;
    Object.keys(patch).forEach(function (key) { step[key] = patch[key]; });
    saveState();
    renderPetSceneList();
  }

  function addSceneStep(sceneId) {
    var scene = petSceneById(sceneId);
    if (!scene) return;
    var first = (state.pets || [])[0];
    if (!first) {
      toast('先添加一只桌宠', true);
      return;
    }
    var last = scene.steps.length ? scene.steps[scene.steps.length - 1] : null;
    scene.steps.push({
      petId: last ? last.petId : first.id,
      mode: 'random',
      clipId: null,
      delayMs: 500
    });
    saveState();
    renderPetSceneList();
  }

  function removeSceneStep(sceneId, index) {
    var scene = petSceneById(sceneId);
    if (!scene) return;
    scene.steps.splice(index, 1);
    saveState();
    renderPetSceneList();
  }

  function moveSceneStep(sceneId, index, delta) {
    var scene = petSceneById(sceneId);
    if (!scene) return;
    var steps = scene.steps;
    var target = index + delta;
    if (target < 0 || target >= steps.length) return;
    var item = steps.splice(index, 1)[0];
    steps.splice(target, 0, item);
    saveState();
    renderPetSceneList();
  }

  function bindPetSceneList() {
    var list = document.getElementById('petSceneList');
    if (!list) return;
    list.addEventListener('change', function (e) {
      var sceneEl = e.target.closest('[data-scene-id]');
      if (!sceneEl) return;
      var sceneId = sceneEl.dataset.sceneId;
      var scene = petSceneById(sceneId);
      if (!scene) return;
      var enabled = e.target.closest('[data-scene-enabled]');
      if (enabled) {
        scene.enabled = enabled.checked;
        saveState();
        renderPetSceneList();
        return;
      }
      var name = e.target.closest('[data-scene-name]');
      if (name) {
        scene.name = name.value.trim().slice(0, 60) || scene.name;
        saveState();
        renderPetSceneList();
        return;
      }
      var field = e.target.closest('[data-step-field]');
      var row = e.target.closest('[data-step-index]');
      if (!field || !row) return;
      var index = Number(row.dataset.stepIndex);
      var fieldName = field.dataset.stepField;
      if (fieldName === 'petId') {
        mutateSceneStep(sceneId, index, { petId: field.value, mode: 'random', clipId: null });
      } else if (fieldName === 'clipId') {
        mutateSceneStep(sceneId, index, {
          mode: field.value ? 'fixed' : 'random',
          clipId: field.value ? Number(field.value) : null
        });
      } else if (fieldName === 'delay') {
        mutateSceneStep(sceneId, index, { delayMs: Math.round(clamp(Number(field.value) || 0, 0, 60) * 1000) });
      }
    });
    list.addEventListener('click', function (e) {
      var sceneEl = e.target.closest('[data-scene-id]');
      if (!sceneEl) return;
      var sceneId = sceneEl.dataset.sceneId;
      var sceneBtn = e.target.closest('[data-scene-action]');
      if (sceneBtn) {
        var sceneAction = sceneBtn.dataset.sceneAction;
        if (sceneAction === 'toggle') {
          ui.petSceneId = ui.petSceneId === sceneId ? null : sceneId;
          renderPetSceneList();
        } else if (sceneAction === 'delete') {
          deletePetScene(sceneId);
        } else if (sceneAction === 'add-step') {
          addSceneStep(sceneId);
        }
        return;
      }
      var stepBtn = e.target.closest('[data-step-action]');
      var row = e.target.closest('[data-step-index]');
      if (!stepBtn || !row) return;
      var index = Number(row.dataset.stepIndex);
      var action = stepBtn.dataset.stepAction;
      if (action === 'delete') removeSceneStep(sceneId, index);
      else if (action === 'up') moveSceneStep(sceneId, index, -1);
      else if (action === 'down') moveSceneStep(sceneId, index, 1);
    });
  }

  function bindPetEvents() {
    var tabs = document.getElementById('petTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-pet-tab]');
        if (!btn) return;
        $$('#petTabs button').forEach(function (item) { item.classList.toggle('is-active', item === btn); });
        $$('.pet-view').forEach(function (view) {
          view.classList.toggle('is-active', view.dataset.petView === btn.dataset.petTab);
        });
      });
    }

    var master = document.getElementById('petMasterBtn');
    if (master) {
      master.addEventListener('click', function () {
        state.settings.petEnabled = !petEnabled();
        saveState();
        renderPetToolbar();
        toast(petEnabled() ? '桌宠已显示' : '桌宠已隐藏');
      });
    }

    var pause = document.getElementById('petPauseBtn');
    if (pause) {
      pause.addEventListener('click', function () {
        state.settings.petPaused = !petPaused();
        saveState();
        renderPetToolbar();
        toast(petPaused() ? '已暂停接话，点桌宠只说自己那句' : '已恢复接话');
      });
    }

    var list = document.getElementById('petList');
    if (list) {
      list.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-pet-action]');
        if (!btn) return;
        var id = btn.dataset.petId;
        var action = btn.dataset.petAction;
        var pet = petById(id);
        if (!pet) return;
        if (action === 'toggle') {
          await platform.pet.update({ id: id, patch: { enabled: pet.enabled === false } });
        } else if (action === 'test') {
          if (petPreviewAudio) { petPreviewAudio.pause(); petPreviewAudio = null; }
          if (ui.petPreviewId === id) { ui.petPreviewId = null; btn.textContent = '试听'; return; }
          var clips = (pet.clips || []).filter(function (clip) { return clip.enabled !== false; });
          if (!clips.length) { toast('这只桌宠还没有可播放的录音', true); return; }
          var clip = clips[Math.floor(Math.random() * clips.length)];
          var audio = new Audio(clip.url || clip.file);
          petPreviewAudio = audio;
          ui.petPreviewId = id;
          btn.textContent = '停止试听';
          audio.onended = function () { ui.petPreviewId = null; btn.textContent = '试听'; };
          audio.onerror = function () { ui.petPreviewId = null; btn.textContent = '试听'; toast('录音无法播放，请检查音频文件', true); };
          audio.play().catch(function () { ui.petPreviewId = null; btn.textContent = '试听'; toast('无法播放此录音，请更换音频文件', true); });
        } else if (action === 'bigger') {
          await platform.pet.resize(id, 20);
        } else if (action === 'smaller') {
          await platform.pet.resize(id, -20);
        } else if (action === 'delete') {
          var confirmed = await askConfirm({
            title: '删除桌宠',
            message: '「' + pet.name + '」和它的录音会从本机删除，不能恢复。',
            okText: '删除'
          });
          if (!confirmed) return;
          await platform.pet.remove(id);
          toast('桌宠已删除');
        }
      });
    }

    var sceneAdd = document.getElementById('petSceneAdd');
    if (sceneAdd) sceneAdd.addEventListener('click', addPetScene);
    bindPetSceneList();

    var pickAvatar = document.getElementById('petPickAvatar');
    if (pickAvatar) {
      pickAvatar.addEventListener('click', async function () {
        var result = await platform.pet.pickAssets('avatar');
        if (!result || !result.ok || !result.path) return;
        petDraft.avatarPath = result.path;
        petDraft.avatarName = result.path.split(/[\\/]/).pop();
        var label = document.getElementById('petAvatarName');
        if (label) label.textContent = petDraft.avatarName;
        var preview = document.getElementById('petDraftImage');
        preview.src = result.url;
        preview.hidden = false;
        document.getElementById('petDraftPlaceholder').hidden = true;
      });
    }

    var pickAudio = document.getElementById('petPickAudio');
    if (pickAudio) {
      pickAudio.addEventListener('click', async function () {
        var result = await platform.pet.pickAssets('audio');
        if (!result || !result.ok || !result.paths || !result.paths.length) return;
        petDraft.audioPaths = result.paths;
        petDraft.audioUrls = result.urls;
        petDraft.audioNames = result.paths.map(function (file) { return file.split(/[\\/]/).pop(); });
        var audioPreview = document.getElementById('petDraftAudio');
        audioPreview.src = result.urls[0];
        audioPreview.hidden = false;
        var label = document.getElementById('petAudioName');
        if (label) label.textContent = petDraft.audioNames.length + ' 段：' + shorten(petDraft.audioNames.join('、'), 30);
        var nameInput = document.getElementById('petNameInput');
        if (nameInput && !nameInput.value.trim() && petDraft.audioNames.length) {
          nameInput.value = petDraft.audioNames[0].replace(/\.[^.]+$/, '');
        }
      });
    }

    var createBtn = document.getElementById('petCreateBtn');
    if (createBtn) {
      createBtn.addEventListener('click', async function () {
        if (!petDraft.avatarPath) {
          toast('先选一张头像图片', true);
          return;
        }
        if (!petDraft.audioPaths.length) {
          toast('先选这个人的原声录音', true);
          return;
        }
        var nameInput = document.getElementById('petNameInput');
        var linesInput = document.getElementById('petLinesInput');
        var name = (nameInput && nameInput.value.trim()) || (petDraft.audioNames[0] || '新桌宠').replace(/\.[^.]+$/, '');
        var labels = linesInput
          ? linesInput.value.split(/\r?\n/).map(function (text) { return text.trim(); }).filter(Boolean)
          : [];
        createBtn.disabled = true;
        var result = await platform.pet.create({
          name: name,
          avatarPath: petDraft.avatarPath,
          audioPaths: petDraft.audioPaths,
          labels: labels,
          durations: petDraft.durations || []
        });
        createBtn.disabled = false;
        if (!result || !result.ok) {
          toast((result && result.error) || '创建失败', true);
          return;
        }
        petDraft = { avatarPath: '', avatarName: '', audioPaths: [], audioNames: [] };
        document.getElementById('petDraftImage').hidden = true;
        document.getElementById('petDraftPlaceholder').hidden = false;
        var audioPreview = document.getElementById('petDraftAudio');
        audioPreview.pause();
        audioPreview.removeAttribute('src');
        audioPreview.hidden = true;
        if (nameInput) nameInput.value = '';
        if (linesInput) linesInput.value = '';
        var avatarLabel = document.getElementById('petAvatarName');
        var audioLabel = document.getElementById('petAudioName');
        if (avatarLabel) avatarLabel.textContent = '未选择';
        if (audioLabel) audioLabel.textContent = '未选择（可多选）';
        toast('「' + name + '」已创建，桌面上可以直接点它了');
      });
    }
  }

  /* ==================== 平台事件 ==================== */
  function bindPlatform() {
    if (!platform) return;
    if (platform.state && platform.state.onChanged) {
      platform.state.onChanged(function (next) { adoptState(next); });
    }
    if (platform.nav && platform.nav.onSettings) {
      platform.nav.onSettings(function (payload) {
        if (VIEW !== 'panel') return;
        applySettingsOpen(payload && payload.section);
      });
    }
    if (platform.window && platform.window.onPanelSize) {
      platform.window.onPanelSize(function (size) {
        if (VIEW !== 'panel' || !size) return;
        el.panel.style.setProperty('--panel-w', Math.round(size.w) + 'px');
        el.panel.style.setProperty('--panel-h', Math.round(size.h) + 'px');
      });
    }
    if (platform.ai) {
      platform.ai.onContext(function (context) {
        if (VIEW !== 'aiDialog') return;
        ui.aiContext = context && context.type ? context : { type: 'none' };
        var incomingQuestion = String(context && context.question || '').trim();
        if (incomingQuestion) fillAIComposerFromPresets(incomingQuestion);
        else if (!String(el.aiQuestion.value || '').trim() && !ui.aiComposer.suppressAutoFill) fillAIComposerFromPresets();
        populateAIContext();
        resetAIResult();
      });
      platform.ai.onDelta(function (payload) {
        if (!payload || payload.requestId !== ui.aiRequestId) return;
        appendAIDelta(String(payload.text || ''));
      });
      platform.ai.onDone(function (payload) {
        if (!payload || payload.requestId !== ui.aiRequestId) return;
        finishAIStream(!!payload.aborted);
      });
      platform.ai.onError(function (payload) {
        if (!payload || payload.requestId !== ui.aiRequestId) return;
        failAIRequest(payload.requestId, payload.message);
      });
    }
  }
  /* ==================== 启动 ==================== */
  function mountGlass() {
    if (typeof window.mountLiquidLens !== 'function') return;
    var targets = [];
    if (VIEW === 'panel') targets.push([el.panel]);
    else if (VIEW === 'launcher') targets.push([el.launcherWindow]);
    else if (VIEW === 'aiHub') targets.push([el.aiHubWindow]);
    else if (VIEW === 'aiPrefs') targets.push([el.aiPrefsWindow]);
    else if (VIEW === 'clip') targets.push([el.clipWindow]);
    else if (VIEW === 'petSettings') targets.push([el.petWindow]);
    else if (VIEW === 'aiDialog') targets.push([el.aiWindow, { blur: 4, sat: 190 }]);
    targets.forEach(function (pair) {
      try { window.mountLiquidLens(pair[0], pair[1]); } catch (e) { /* 保留纯磨砂回退 */ }
    });
  }

  /* ==================== 窗口拖动 ==================== */
  /* 按住各页标题栏，或窗口四周的透明外边距，都能拖动整个窗口 */
  function bindWindowDrag() {
    if (!platform || !platform.window || !platform.window.dragStart) return;
    if (VIEW === 'shot' || VIEW === 'pet') return;

    var HEAD = '.panel-head, .set-head, .launcher-head, .func-head, .ai-head';
    var activeId = null;
    var pending = null;
    var rafId = 0;

    function resizeDirectionAt(clientX, clientY) {
      var root = activeWindowElement();
      if (!root) return '';
      var rect = root.getBoundingClientRect();
      var outside = 10;
      var inside = 7;
      var west = clientX >= rect.left - outside && clientX <= rect.left + inside;
      var east = clientX >= rect.right - inside && clientX <= rect.right + outside;
      var north = clientY >= rect.top - outside && clientY <= rect.top + inside;
      var south = clientY >= rect.bottom - inside && clientY <= rect.bottom + outside;
      return (north ? 'n' : south ? 's' : '') + (west ? 'w' : east ? 'e' : '');
    }

    function flush() {
      rafId = 0;
      if (!pending) return;
      platform.window.dragMove(pending.x, pending.y);
      pending = null;
    }

    document.addEventListener('pointerdown', function (e) {
      if (windowGesture || activeId !== null || e.defaultPrevented || e.button !== 0 || e.isPrimary === false) return;
      var target = e.target;
      var resizeDir = resizeDirectionAt(e.clientX, e.clientY);
      if (resizeDir && beginPanelResize) {
        beginPanelResize(resizeDir, e, document.documentElement);
        return;
      }
      if (!target || !target.closest) return;
      /* 捕获阶段先让出缩放热区，否则它们在面板外会被误判成透明拖动区。 */
      if (target.closest('.rz, .resize-grip') || el.panel.classList.contains('is-resizing')) return;
      if (target.closest('button, a, input, textarea, select, [data-no-drag], .modal-layer, .clip-viewer, .menu')) return;
      var inHeader = !!target.closest(HEAD);
      var inWindow = !!target.closest('.panel, .launcher-window, .func-window, .ai-window');
      if (!inHeader && inWindow) return;
      windowGesture = 'move';
      activeId = e.pointerId;
      var lockedWindow = activeWindowElement();
      var lockedRect = lockedWindow ? lockedWindow.getBoundingClientRect() : null;
      if (lockedRect) {
        document.documentElement.style.setProperty('--window-lock-w', Math.round(lockedRect.width) + 'px');
        document.documentElement.style.setProperty('--window-lock-h', Math.round(lockedRect.height) + 'px');
        document.documentElement.classList.add('is-window-size-locked');
      }
      document.documentElement.classList.add('is-window-dragging');
      try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      platform.window.dragStart(e.screenX, e.screenY);
      e.preventDefault();
      e.stopPropagation();
    }, true);

    document.addEventListener('pointermove', function (e) {
      if (activeId === null || e.pointerId !== activeId) return;
      pending = { x: e.screenX, y: e.screenY };
      if (!rafId) rafId = requestAnimationFrame(flush);
    }, true);

    function stopDrag(e) {
      if (activeId === null) return;
      if (e && e.pointerId !== undefined && e.pointerId !== activeId) return;
      var pointerId = activeId;
      if (e && e.type === 'pointerup') pending = { x: e.screenX, y: e.screenY };
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      flush();
      activeId = null;
      windowGesture = null;
      document.documentElement.classList.remove('is-window-size-locked');
      document.documentElement.style.removeProperty('--window-lock-w');
      document.documentElement.style.removeProperty('--window-lock-h');
      document.documentElement.classList.remove('is-window-dragging');
      try { document.documentElement.releasePointerCapture(pointerId); } catch (err) { /* 已失去捕获时无需释放 */ }
      platform.window.dragEnd();
    }

    document.addEventListener('pointerup', stopDrag, true);
    document.addEventListener('pointercancel', stopDrag, true);
    document.addEventListener('lostpointercapture', stopDrag, true);
    window.addEventListener('blur', function () { stopDrag(); });
  }

  function init() {
    document.documentElement.dataset.view = VIEW;
    applyTheme(state.settings.theme, false);
    applyPanelSize(state.settings.panelSize);
    fillSettings();
    renderAll();
    renderAIChips();
    renderAIPageSummary();
    renderAIPrefsSettings();
    updateAIStatus();
    updateSearchUI();
    updatePinUI();
    renderClipList();
    updateClipStatus();
    bindEvents();
    bindPetEvents();
    bindPlatform();
    if (VIEW === 'aiDialog') fillAIComposerFromPresets();
    bindWindowDrag();
    renderPetSettings();

    mountGlass();

    if (VIEW === 'panel') {
      setTimeout(function () {
        el.panel.classList.remove('is-entering');
      }, 700);
      setTimeout(function () {
        toast('点左上角菜单打开功能启动器；选中文字后按 ' + (state.settings.hotkeys.select || 'Alt+Q') + ' 可直接提问');
      }, 900);
    }
  }

  init();
})();
