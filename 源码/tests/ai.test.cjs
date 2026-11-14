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
  requests.push({ url: req.url, method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : null });
  reply(req, res);
});
const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => new Promise(resolve => server.close(resolve)));
async function config() {
  await ready;
  return { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'test-only-key', model: 'test-model' };
}
function jsonResponse(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
test('selected persona and task reach the real request alongside the question and selected text', async () => {
  reply = (_req, res) => jsonResponse(res, { choices: [{ message: { content: '实际回答' } }] });
  const output = await ai.streamChat({ config: await config(), persona: { text: '角色指令' }, prompt: { text: '任务指令' },
    context: { type: 'text', text: '用户选中的原文' }, question: '用户补充要求' });
  assert.equal(output, '实际回答');
  const body = requests.at(-1).body;
  assert.equal(body.model, 'test-model');
  assert.ok(body.messages[0].content.includes('角色指令'));
  for (const text of ['任务指令', '用户选中的原文', '用户补充要求']) assert.ok(body.messages[1].content.includes(text));
});
test('ordinary questions work without selected text or screenshots', async () => {
  reply = (_req, res) => jsonResponse(res, { choices: [{ message: { content: '普通提问回答' } }] });
  assert.equal(await ai.streamChat({ config: await config(), context: { type: 'none' }, question: '今天应该做什么？' }), '普通提问回答');
  assert.ok(requests.at(-1).body.messages[1].content.includes('今天应该做什么？'));
});
test('screenshot content is sent as a multimodal message with the chosen task', async () => {
  reply = (_req, res) => jsonResponse(res, { choices: [{ message: { content: '图像回答' } }] });
  await ai.streamChat({ config: await config(), prompt: { text: '只解释图片中的错误' },
    context: { type: 'image', imageDataUrl: 'data:image/png;base64,TEST' }, question: '如何修复？' });
  const content = requests.at(-1).body.messages[1].content;
  assert.ok(content[0].text.includes('只解释图片中的错误'));
  assert.equal(content[1].image_url.url, 'data:image/png;base64,TEST');
});
test('a streaming final event without a trailing newline is not lost', async () => {
  reply = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n');
    res.end('data: {"choices":[{"delta":{"content":"最后一段"}}]}');
  };
  assert.equal(await ai.streamChat({ config: await config(), question: '测试流式' }), '第一段最后一段');
});
test('stream error events are reported instead of pretending the response succeeded', async () => {
  reply = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"error":{"message":"provider overloaded"}}\n\n');
  };
  await assert.rejects(ai.streamChat({ config: await config(), question: '测试错误' }), /provider overloaded/);
});
test('authentication errors give an actionable message and never repeat the API key', async () => {
  reply = (_req, res) => jsonResponse(res, { error: { message: 'invalid key: test-only-key' } }, 401);
  await assert.rejects(ai.streamChat({ config: await config(), question: '测试认证' }), error => {
    assert.match(error.message, /API Key/);
    assert.ok(!error.message.includes('test-only-key'));
    return true;
  });
});
test('connection testing verifies inference for the selected model rather than only the model list', async () => {
  reply = (req, res) => req.method === 'GET'
    ? jsonResponse(res, { data: [{ id: 'test-model' }] })
    : jsonResponse(res, { error: { message: 'model access denied' } }, 403);
  await assert.rejects(ai.testConnection(await config()), /权限|403|denied/);
});
test('model discovery returns actual names and image support and excludes incompatible routes', async () => {
  reply = (_req, res) => jsonResponse(res, { data: [
    { id: 'vision-model', name: '真实视觉模型', modalities: { input: ['text', 'image/png'] }, api: { 'chat-completions': {} } },
    { id: 'text-model', name: '真实文字模型', modalities: { input: ['text'] } },
    { id: 'responses-only', api: { responses: {} } }
  ] });
  assert.deepEqual(await ai.listModels(await config()), [
    { id: 'vision-model', name: '真实视觉模型', supportsImages: true },
    { id: 'text-model', name: '真实文字模型', supportsImages: false }
  ]);
});
