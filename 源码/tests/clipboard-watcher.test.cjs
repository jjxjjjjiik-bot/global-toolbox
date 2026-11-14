'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Replace only the system clipboard boundary; never read or change the user's clipboard.
const sandbox = { module: { exports: {} }, clearInterval, require: id => id === 'electron' ? { clipboard: {}, nativeImage: {} } : require(id) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/clipboard-watcher.js'), 'utf8'), sandbox);
const { ClipboardWatcher } = sandbox.module.exports;

function fixture() {
  const entries = [];
  const watcher = new ClipboardWatcher({
    getState: () => ({ settings: { clipboardWatch: true } }), onEntry: payload => entries.push(payload)
  });
  watcher.primed = true;
  return { watcher, entries };
}

test('an app-owned clipboard write is ignored after suspension expires', async () => {
  const { watcher, entries } = fixture();
  watcher.lastSig = 'previous';
  watcher.snapshot = async () => ({ sig: 'copied-history' });
  watcher.mark('copied-history');
  await watcher.poll();
  assert.equal(entries.length, 0);
});

test('suspension invalidates a poll already waiting on clipboard data', async () => {
  const { watcher, entries } = fixture();
  let complete;
  watcher.snapshot = () => new Promise(resolve => { complete = resolve; });
  const polling = watcher.poll();
  watcher.suspend(900);
  complete({ sig: 'stale-read' });
  await polling;
  assert.equal(entries.length, 0);
});

test('a stale poll cannot overwrite the signature marked by an app-owned write', async () => {
  const { watcher, entries } = fixture();
  let complete;
  watcher.snapshot = () => new Promise(resolve => { complete = resolve; });
  const polling = watcher.poll();
  watcher.mark('app-write');
  complete({ sig: 'old-system-content' });
  await polling;
  assert.equal(entries.length, 0);
  assert.equal(watcher.lastSig, 'app-write');
});

test('genuinely new external content is still recorded exactly once', async () => {
  const { watcher, entries } = fixture();
  watcher.mark('app-write');
  watcher.snapshot = async () => ({ sig: 'new-external-content' });
  await watcher.poll();
  await watcher.poll();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sig, 'new-external-content');
});

test('stopping monitoring invalidates an in-flight read', async () => {
  const { watcher, entries } = fixture();
  let complete;
  watcher.snapshot = () => new Promise(resolve => { complete = resolve; });
  const polling = watcher.poll();
  watcher.stop();
  complete({ sig: 'arrived-after-stop' });
  await polling;
  assert.equal(entries.length, 0);
});
