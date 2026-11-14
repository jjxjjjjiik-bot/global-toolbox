'use strict';

const { randomUUID } = require('node:crypto');
const { version } = require('../package.json');
const opencodeSession = 'toolbox-' + randomUUID();
const BASE_SYSTEM_PROMPT = '默认输出纯文字，不使用 Markdown 语法或代码围栏；不要寒暄、复述问题或添加多余总结，直接、简洁地回答。';

function requestHeaders(config) {
  const headers = {};
  if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
  try {
    const url = new URL(config.baseUrl);
    // OCG 要求稳定的会话标识；只对官方 Go 路由发送，避免影响其它兼容接口。
    if (url.protocol === 'https:' && url.hostname === 'opencode.ai' && /^\/inference\/go(?:\/|$)/.test(url.pathname)) {
      headers['x-opencode-session'] = opencodeSession;
      headers['User-Agent'] = 'global-toolbox/' + version;
    }
  } catch (err) { /* URL 校验由调用方处理 */ }
  return headers;
}

function trimBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function chatUrl(baseUrl) {
  const root = trimBase(baseUrl);
  if (!root) return '';
  if (/\/chat\/completions$/i.test(root)) return root;
  return root + '/chat/completions';
}

function modelsUrl(baseUrl) {
  const root = trimBase(baseUrl);
  if (!root) return '';
  return root.replace(/\/chat\/completions$/i, '') + '/models';
}

function buildInstruction(prompt, context, question) {
  const parts = [];
  const promptText = prompt && prompt.text ? String(prompt.text).trim() : '';
  if (promptText) parts.push(promptText);

  if (context && context.type === 'text' && context.text) {
    parts.push('选中内容：\n' + String(context.text).trim());
  } else if (context && context.type === 'image') {
    parts.push('下面是用户框选的截图，请结合截图内容回答。');
  }

  const q = String(question || '').trim();
  if (q) parts.push('补充要求：\n' + q);
  if (!parts.length) parts.push('请直接回答用户的问题。');
  return parts.join('\n\n');
}

function buildEditorInstruction(context, question) {
  const parts = [];
  const visible = String(question || '').trim();
  if (visible) parts.push(visible);
  if (context && context.type === 'text' && context.text) {
    parts.push('选中内容：\n' + String(context.text).trim());
  }
  return parts.join('\n\n');
}

function buildMessages(options) {
  const messages = [];
  const editorMode = options.mode === 'editor';
  const persona = options.persona;
  const systemParts = [BASE_SYSTEM_PROMPT];
  if (!editorMode && persona && persona.text) systemParts.push(String(persona.text).trim());
  if (options.userContext) systemParts.push('用户的固定补充信息：\n' + String(options.userContext).trim());
  messages.push({ role: 'system', content: systemParts.filter(Boolean).join('\n\n') });

  const instruction = editorMode
    ? buildEditorInstruction(options.context, options.question)
    : buildInstruction(options.prompt, options.context, options.question);
  const context = options.context;

  if (context && context.type === 'image' && context.imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: context.imageDataUrl } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: instruction });
  }
  return messages;
}

async function readError(res, config) {
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        detail = (json.error && (json.error.message || json.error.code)) || text;
      } catch (e) {
        detail = text;
      }
    }
  } catch (e) { /* ignore */ }
  detail = String(detail || '').replace(/\s+/g, ' ').slice(0, 300);
  if (config && config.apiKey) detail = detail.split(config.apiKey).join('[已隐藏]');
  const messages = {
    401: '认证失败，请在连接设置中检查 API Key。',
    403: '当前密钥没有调用此模型的权限，请切换模型或检查服务权限。',
    404: '没有找到模型或接口，请检查服务地址和模型名称。',
    429: '服务限流或额度不足，请检查账户额度后重试。',
    500: 'AI 服务内部出错，请稍后重试。',
    502: 'AI 服务暂时无法响应，请稍后重试。',
    503: 'AI 服务繁忙，请稍后重试。'
  };
  return (messages[res.status] || detail || 'AI 服务请求失败') + '（HTTP ' + res.status + '）';
}

async function streamChat(options) {
  const config = options.config || {};
  const url = chatUrl(config.baseUrl);
  if (!url) throw new Error('还没有配置 Base URL');
  if (!config.model) throw new Error('还没有配置模型名称');

  const headers = Object.assign({ 'Content-Type': 'application/json' }, requestHeaders(config));

  const body = {
    model: config.model,
    messages: buildMessages(options),
    stream: true
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.reasoningEffort || config.reasoningEffort) body.reasoning_effort = options.reasoningEffort || config.reasoningEffort;

  const res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: options.signal
  });

  if (!res.ok) throw new Error(await readError(res, config));

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  let full = '';

  if (contentType.indexOf('text/event-stream') >= 0 && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    function consume(line) {
      line = line.replace(/\r$/, '');
      if (!line || line.indexOf('data:') !== 0) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let json;
      try { json = JSON.parse(payload); } catch (err) { return; }
      if (json.error) throw new Error(String(json.error.message || 'AI 服务中断了生成'));
      const choice = json.choices && json.choices[0];
      const delta = choice && (choice.delta || choice.message);
      const piece = delta && delta.content;
      if (typeof piece === 'string' && piece) {
        full += piece;
        if (typeof options.onDelta === 'function') options.onDelta(piece);
      }
    }

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      lines.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) buffer.split('\n').forEach(consume);
  } else {
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('接口返回的不是 JSON：' + text.slice(0, 200)); }
    if (json.error) throw new Error(json.error.message || '接口返回错误');
    const choice = json.choices && json.choices[0];
    full = (choice && ((choice.message && choice.message.content) || choice.text)) || '';
    if (full && typeof options.onDelta === 'function') options.onDelta(full);
  }

  if (!String(full).trim()) throw new Error('模型没有返回回答，请重试或切换模型。');
  if (typeof options.onDone === 'function') options.onDone(full);
  return full;
}

async function listModels(config) {
  const base = trimBase(config.baseUrl);
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 需要以 http:// 或 https:// 开头');
  const res = await fetch(modelsUrl(base), {
    headers: requestHeaders(config), signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(await readError(res, config));
  const json = await res.json();
  return (Array.isArray(json.data) ? json.data : []).filter(function (model) {
    return model.id && (!model.api || Object.prototype.hasOwnProperty.call(model.api, 'chat-completions'));
  }).map(function (model) {
    const input = model.modalities && model.modalities.input || [];
    return { id: String(model.id), name: String(model.name || model.id), supportsImages: input.some(type => type === 'image' || type.indexOf('image/') === 0) };
  });
}

async function testConnection(config) {
  if (!/^https?:\/\//i.test(trimBase(config.baseUrl))) throw new Error('服务地址需要以 http:// 或 https:// 开头');
  if (!String(config.model || '').trim()) throw new Error('请先选择或填写模型');
  const start = Date.now();
  const isGo = /^https:\/\/opencode\.ai\/inference\/go(?:\/|$)/i.test(config.baseUrl);
  const answer = await streamChat({ config, question: '只回复 OK', maxTokens: 256,
    reasoningEffort: isGo ? 'low' : undefined, signal: AbortSignal.timeout(30000) });
  return { ok: true, mode: 'chat', model: config.model, latencyMs: Date.now() - start, answer: answer.slice(0, 100) };
}

module.exports = { streamChat, testConnection, listModels, chatUrl, modelsUrl, buildMessages, BASE_SYSTEM_PROMPT };
