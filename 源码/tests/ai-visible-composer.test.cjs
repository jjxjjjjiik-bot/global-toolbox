'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ai = require('../electron/ai');

let reply;
const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  requests.push({ url: req.url, method: req.method, body: raw ? JSON.parse(raw) : null });
  reply(req, res);
});
const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => new Promise(resolve => server.close(resolve)));

async function config() {
  await ready;
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
    apiKey: 'test-only-key',
    model: 'test-model'
  };
}

function jsonResponse(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

test('editor mode sends the visible composer text without reinjecting templates', async () => {
  reply = (_req, res) => jsonResponse(res, { choices: [{ message: { content: '实际回答' } }] });
  const visible = '只保留我在输入框里写的人设和任务。\n\n再补一句自己的要求。';
  const output = await ai.streamChat({
    config: await config(),
    mode: 'editor',
    persona: { text: '不应出现的旧人设' },
    prompt: { text: '不应出现的旧任务' },
    context: { type: 'text', text: '选中的原文' },
    question: visible
  });
  assert.equal(output, '实际回答');
  const messages = requests.at(-1).body.messages;
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.includes(ai.BASE_SYSTEM_PROMPT));
  assert.ok(!messages[0].content.includes('不应出现的旧人设'));
  assert.ok(!messages[0].content.includes('不应出现的旧任务'));
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.startsWith(visible));
  assert.ok(messages[1].content.includes('选中的原文'));
  assert.ok(!messages[1].content.includes('不应出现的旧人设'));
  assert.ok(!messages[1].content.includes('不应出现的旧任务'));
  assert.equal(messages[1].content.includes('补充要求：'), false);
});

test('editor mode keeps an image context attached to the same visible request', () => {
  const messages = ai.buildMessages({
    mode: 'editor',
    question: '截图里哪里错了？',
    context: { type: 'image', imageDataUrl: 'data:image/png;base64,TEST' }
  });
  assert.equal(messages[1].content[0].text, '截图里哪里错了？');
  assert.equal(messages[1].content[1].image_url.url, 'data:image/png;base64,TEST');
});

test('legacy persona and prompt calls remain compatible', () => {
  const messages = ai.buildMessages({
    persona: { text: '旧人设' },
    prompt: { text: '旧任务' },
    context: { type: 'text', text: '旧原文' },
    question: '旧补充'
  });
  assert.ok(messages[0].content.includes('旧人设'));
  assert.ok(messages[1].content.includes('旧任务'));
  assert.ok(messages[1].content.includes('旧原文'));
  assert.ok(messages[1].content.includes('补充要求：\n旧补充'));
});
