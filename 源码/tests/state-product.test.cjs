'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultState } = require('../electron/seed');
const state = require('../electron/state');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('a new installation does not invent personal snippets, model names or API credentials', () => {
  const fresh = defaultState();
  assert.deepEqual(fresh.items, []);
  assert.equal(fresh.settings.ai.model, '');
  assert.equal(fresh.settings.ai.apiKey, '');
  assert.equal(fresh.settings.petEnabled, false);
});
test('removing all presets remains empty instead of silently restoring presets', () => {
  const saved = state.normalize({ personas: [], prompts: [] });
  assert.deepEqual(saved.personas, []);
  assert.deepEqual(saved.prompts, []);
  assert.equal(saved.settings.personaId, '');
  assert.equal(saved.settings.promptId, '');
});
test('custom role and task names stay separate from their complete instructions', () => {
  const saved = state.normalize({ personas: [{ id: 'review', name: '审稿人', text: '先指出证据问题。\n再建议验证实验。' }],
    prompts: [{ id: 'check', name: '检查结论', text: '逐条核对主张与实验是否对应。' }],
    settings: { personaId: 'review', promptId: 'check' } });
  assert.equal(saved.personas[0].name, '审稿人');
  assert.equal(saved.personas[0].text, '先指出证据问题。\n再建议验证实验。');
  assert.equal(saved.settings.personaId, 'review');
  assert.equal(saved.settings.promptId, 'check');
});
test('invalid or deleted preset selections resolve to an existing preset', () => {
  const saved = state.normalize({ personas: [{ id: 'real', name: '真实人设', text: '实际人设指令' }],
    prompts: [{ id: 'task', name: '真实任务', text: '实际任务指令' }],
    settings: { personaId: 'deleted', promptId: 'deleted' } });
  assert.equal(saved.settings.personaId, 'real');
  assert.equal(saved.settings.promptId, 'task');
});

test('legacy reply rules and theater migrate into enabled reply scenes', () => {
  const saved = state.normalize({
    replyRules: {
      sun: [{ petId: 'feng', mode: 'fixed', clipId: 2, delayMs: 450 }]
    },
    theater: {
      loop: true,
      steps: [
        { petId: 'shaolan', mode: 'random', clipId: null, delayMs: 0 },
        { petId: 'sun', mode: 'random', clipId: null, delayMs: 250 }
      ]
    }
  });
  assert.equal(saved.replyScenes.length, 2);
  assert.equal(saved.replyScenes[0].name, '孙宇晨开场');
  assert.equal(saved.replyScenes[0].enabled, true);
  assert.deepEqual(saved.replyScenes[0].steps.map(step => step.petId), ['sun', 'feng']);
  assert.equal(saved.replyScenes[0].steps[1].clipId, 2);
  assert.equal(saved.replyScenes[1].name, '小剧场');
  assert.deepEqual(saved.replyScenes[1].steps.map(step => step.petId), ['shaolan', 'sun']);
  assert.equal('replyRules' in saved, false);
  assert.equal('theater' in saved, false);
});

test('reply scene selection only considers enabled scenes with the clicked first speaker', () => {
  const scenes = [
    { id: 'first', enabled: true, steps: [{ petId: 'shaolan' }] },
    { id: 'disabled', enabled: false, steps: [{ petId: 'shaolan' }] },
    { id: 'second', enabled: true, steps: [{ petId: 'shaolan' }, { petId: 'sun' }] },
    { id: 'other', enabled: true, steps: [{ petId: 'feng' }] }
  ];
  assert.equal(state.selectReplyScene(scenes, 'shaolan', () => 0).id, 'first');
  assert.equal(state.selectReplyScene(scenes, 'shaolan', () => 0.99).id, 'second');
  assert.equal(state.selectReplyScene(scenes, 'feng', () => 0).id, 'other');
  assert.equal(state.selectReplyScene(scenes, 'sun', () => 0), null);
  assert.equal(state.selectReplyScene(scenes, 'shaolan', () => 1).id, 'second');
});

test('dedicated AI configuration survives an older process rewriting the main state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-state-tests-'));
  try {
    state.init(directory);
    const fresh = defaultState();
    fresh.settings.ai = { baseUrl: 'https://service.example/v1', model: 'actual-model', apiKey: 'test-only-secret' };
    state.flush(fresh);
    const disk = JSON.parse(fs.readFileSync(path.join(directory, 'data.json'), 'utf8'));
    assert.equal(disk.settings.ai.apiKey, '');
    disk.settings.ai = { baseUrl: 'https://old.example/v1', model: 'old-demo-model', apiKey: '' };
    fs.writeFileSync(path.join(directory, 'data.json'), JSON.stringify(disk));
    const loaded = state.load();
    assert.equal(loaded.settings.ai.model, 'actual-model');
    assert.equal(loaded.settings.ai.apiKey, 'test-only-secret');
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('toolbox-state-tests-'));
    fs.rmSync(directory, { recursive: true, force: true });
    console.log('Removed temporary state test directory: ' + directory);
  }
});
