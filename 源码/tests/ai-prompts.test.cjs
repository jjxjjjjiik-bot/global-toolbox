'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildMessages, BASE_SYSTEM_PROMPT } = require('../electron/ai');

test('default system instruction requires concise plain text without Markdown', () => {
  const messages = buildMessages({
    persona: { text: '先给结论。' },
    prompt: { text: '解释选中内容。' },
    userContext: '我是自动化专业学生。',
    context: { type: 'text', text: '原文' },
    question: '怎么看？'
  });
  const system = messages[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /纯文字/);
  assert.match(system.content, /不使用 Markdown/);
  assert.match(system.content, /直接、简洁/);
  assert.match(system.content, /先给结论/);
  assert.match(system.content, /我是自动化专业学生/);
  assert.equal(BASE_SYSTEM_PROMPT.includes('寒暄'), true);
});

test('user context is included before the request instruction', () => {
  const messages = buildMessages({
    userContext: '固定补充信息',
    prompt: { text: '固定任务' },
    context: { type: 'none' },
    question: '本次问题'
  });
  const instruction = messages.find(message => message.role === 'user').content;
  assert.ok(instruction.indexOf('固定任务') < instruction.indexOf('本次问题'));
});
