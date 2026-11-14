'use strict';

const assert = require('node:assert/strict');

module.exports = function ({ tests, reset, evaluate, pointer, win }) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function groupSelector(id) {
    return '#tabs .tab[data-group="' + id + '"]';
  }

  async function groupRect(id) {
    return evaluate(`(function () {
      var rect = document.querySelector(${JSON.stringify(groupSelector(id))}).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
  }

  async function openGroupContext(id) {
    const rect = await groupRect(id);
    await evaluate(`(function () {
      var tab = document.querySelector(${JSON.stringify(groupSelector(id))});
      tab.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: ${rect.x + rect.width / 2}, clientY: ${rect.y + rect.height / 2}
      }));
      return true;
    })()`);
    await wait(30);
  }

  async function flushState() {
    return evaluate('Promise.resolve().then(function () { return window.platform.state.get(); })');
  }

  function reloadPage() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('page reload timed out')), 5000);
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        evaluate("document.fonts.ready.then(function () { return !!document.querySelector('#tabs'); })").then(resolve, reject);
      });
      win.reload();
    });
  }

  tests.push(['group tabs still switch on a normal click', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const target = initial.groups[1];
    await evaluate(`document.querySelector(${JSON.stringify(groupSelector(target.id))}).click()`);
    await wait(20);
    assert.equal(await evaluate(`document.querySelector('#tabs .tab.is-active').dataset.group`), target.id);
    assert.equal(await evaluate("document.documentElement.classList.contains('is-window-dragging')"), false);
  }]);

  tests.push(['long press drag reorders a group and persists without switching it', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const source = initial.groups[0];
    const target = initial.groups[1];
    const sourceRect = await groupRect(source.id);
    const targetRect = await groupRect(target.id);
    const sourceX = sourceRect.x + sourceRect.width / 2;
    const sourceY = sourceRect.y + sourceRect.height / 2;
    const targetX = targetRect.x + targetRect.width * 0.85;
    const bounds = win.getBounds();

    await pointer(groupSelector(source.id), 'pointerdown', sourceX, sourceY, { clientX: sourceX, clientY: sourceY });
    await wait(390);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(groupSelector(source.id))}).classList.contains('is-group-dragging')`), true);
    await pointer(groupSelector(source.id), 'pointermove', targetX, sourceY, { clientX: targetX, clientY: sourceY });
    await evaluate(`(function () {
      var source = document.querySelector(${JSON.stringify(groupSelector(source.id))});
      source.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
        button: 0, buttons: 0, clientX: ${targetX}, clientY: ${sourceY},
        screenX: ${targetX}, screenY: ${sourceY}
      }));
      var target = document.querySelector(${JSON.stringify(groupSelector(target.id))});
      if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await wait(30);

    const ordered = await flushState();
    assert.deepEqual(ordered.groups.map(group => group.id).slice(0, 2), [target.id, source.id]);
    assert.equal(await evaluate("document.querySelector('#tabs .tab.is-active').dataset.group"), 'all');
    assert.equal(await evaluate("document.documentElement.classList.contains('is-window-dragging')"), false);
    assert.deepEqual(win.getBounds(), bounds);

    await reloadPage();
    const reloaded = await evaluate('window.platform.state.get()');
    const visibleOrder = await evaluate(`Array.from(document.querySelectorAll('#tabs .tab[data-group]')).map(function (tab) { return tab.dataset.group; })`);
    assert.deepEqual(reloaded.groups.map(group => group.id).slice(0, 2), [target.id, source.id]);
    assert.deepEqual(visibleOrder.slice(0, 3), ['all', target.id, source.id]);
  }]);

  tests.push(['pointercancel clears a pending group drag without reordering', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const source = initial.groups[0];
    const rect = await groupRect(source.id);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await pointer(groupSelector(source.id), 'pointerdown', x, y, { clientX: x, clientY: y });
    await wait(390);
    assert.equal(await evaluate("document.querySelectorAll('#tabs .tab.is-group-dragging').length"), 1);
    await pointer(groupSelector(source.id), 'pointercancel', x + 30, y, { clientX: x + 30, clientY: y });
    await wait(20);
    assert.equal(await evaluate("document.querySelectorAll('#tabs .tab.is-group-dragging').length"), 0);
    assert.equal(await evaluate("document.documentElement.classList.contains('is-group-reordering')"), false);
    assert.deepEqual((await flushState()).groups.map(group => group.id), initial.groups.map(group => group.id));
  }]);

  tests.push(['right click opens a foreground group menu', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const group = initial.groups[1];
    await openGroupContext(group.id);
    const menu = await evaluate(`(function () {
      var menu = document.querySelector('#groupMenu.group-context-menu');
      if (!menu || !menu.classList.contains('is-open')) return null;
      var item = menu.querySelector('[data-group-action]');
      var rect = item.getBoundingClientRect();
      var hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { itemTop: !!hit && (hit === item || item.contains(hit)), contains: menu.contains(hit) };
    })()`);
    assert.deepEqual(menu, { itemTop: true, contains: true });
  }]);

  tests.push(['renaming a group reuses the modal and preserves its id', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const group = initial.groups[1];
    await openGroupContext(group.id);
    await evaluate("document.querySelector('#groupMenu [data-group-action=\"rename\"]').click()");
    assert.equal(await evaluate("document.querySelector('#groupLayer').classList.contains('is-open')"), true);
    assert.equal(await evaluate("document.querySelector('#groupTitle').textContent"), '重命名分组');
    assert.equal(await evaluate("document.querySelector('#groupNameInput').value"), group.name);
    await evaluate("document.querySelector('#groupNameInput').value = '  改过的分组  '; document.querySelector('#groupSave').click()");
    const renamed = await flushState();
    const saved = renamed.groups.find(item => item.id === group.id);
    assert.equal(saved.name, '改过的分组');
    assert.equal(renamed.groups.length, initial.groups.length);
    assert.equal(await evaluate("document.querySelector('#groupLayer').classList.contains('is-open')"), false);
  }]);

  tests.push(['cancelling group deletion changes neither groups nor entries', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const group = initial.groups[0];
    await openGroupContext(group.id);
    await evaluate("document.querySelector('#groupMenu [data-group-action=\"delete\"]').click()");
    await wait(20);
    assert.equal(await evaluate("document.querySelector('#confirmLayer').classList.contains('is-open')"), true);
    const message = await evaluate("document.querySelector('#confirmText').textContent");
    assert.match(message, /词条/);
    await evaluate("document.querySelector('#confirmCancel').click()");
    await wait(20);
    const after = await flushState();
    assert.deepEqual(after.groups, initial.groups);
    assert.deepEqual(after.items, initial.items);
  }]);

  tests.push(['confirming group deletion moves entries to a remaining group and persists', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const group = initial.groups[0];
    const remaining = initial.groups.slice(1);
    await openGroupContext(group.id);
    await evaluate("document.querySelector('#groupMenu [data-group-action=\"delete\"]').click()");
    await wait(20);
    const message = await evaluate("document.querySelector('#confirmText').textContent");
    assert.ok(remaining.some(item => message.includes(item.name)));
    await evaluate("document.querySelector('#confirmOk').click()");
    const deleted = await flushState();
    assert.equal(deleted.groups.some(item => item.id === group.id), false);
    assert.equal(deleted.groups.length, initial.groups.length - 1);
    assert.equal(deleted.items.length, initial.items.length);
    assert.equal(deleted.items.every(item => remaining.some(target => target.id === item.groupId)), true);

    await reloadPage();
    const reloaded = await evaluate('window.platform.state.get()');
    assert.equal(reloaded.groups.some(item => item.id === group.id), false);
    assert.equal(reloaded.items.length, initial.items.length);
  }]);

  tests.push(['the last remaining group cannot be deleted', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const only = initial.groups[0];
    const changed = Object.assign({}, initial, {
      groups: [{ id: only.id, name: only.name }],
      items: initial.items.map(item => Object.assign({}, item, { groupId: only.id }))
    });
    await evaluate('window.platform.state.set(' + JSON.stringify(changed) + ')');
    await reloadPage();
    await openGroupContext(only.id);
    await evaluate("document.querySelector('#groupMenu [data-group-action=\"delete\"]').click()");
    await wait(20);
    assert.equal(await evaluate("document.querySelector('#confirmLayer').classList.contains('is-open')"), false);
    assert.match(await evaluate("document.querySelector('#toast').textContent"), /至少保留一个分组/);
    const saved = await evaluate('window.platform.state.get()');
    assert.deepEqual(saved.groups, [{ id: only.id, name: only.name }]);
    assert.equal(saved.items.length, initial.items.length);
  }]);

  tests.push(['the all tab stays fixed and the add button still creates groups', async () => {
    const initial = await evaluate('window.platform.state.get()');
    const allRect = await evaluate(`(function () {
      var rect = document.querySelector('#tabs .tab[data-group="all"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    await evaluate(`(function () {
      document.querySelector('#tabs .tab[data-group="all"]').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: ${allRect.x + allRect.width / 2}, clientY: ${allRect.y + allRect.height / 2}
      }));
      return true;
    })()`);
    assert.equal(await evaluate("document.querySelector('#groupMenu').classList.contains('is-open')"), false);
    await pointer('#tabs .tab[data-group="all"]', 'pointerdown', allRect.x + allRect.width / 2, allRect.y + allRect.height / 2, {
      clientX: allRect.x + allRect.width / 2,
      clientY: allRect.y + allRect.height / 2
    });
    await wait(390);
    assert.equal(await evaluate("document.querySelectorAll('#tabs .tab.is-group-dragging').length"), 0);
    await pointer('#tabs .tab[data-group="all"]', 'pointerup', allRect.x + allRect.width / 2, allRect.y + allRect.height / 2, {
      clientX: allRect.x + allRect.width / 2,
      clientY: allRect.y + allRect.height / 2
    });
    await evaluate("document.querySelector('#addGroupBtn').click()");
    assert.equal(await evaluate("document.querySelector('#groupTitle').textContent"), '新建分组');
    assert.equal(await evaluate("document.querySelector('#groupLayer').classList.contains('is-open')"), true);
    await evaluate("document.querySelector('[data-close=\"group\"]').click()");
    assert.equal((await evaluate('window.platform.state.get()')).groups.length, initial.groups.length);
  }]);
};
