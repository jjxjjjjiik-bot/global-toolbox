(function () {
  'use strict';

  var platform = window.platform;
  var params = new URLSearchParams(location.search);

  var bg = document.getElementById('shotBg');
  var box = document.getElementById('shotBox');
  var sizeLabel = document.getElementById('shotSize');
  var bar = document.getElementById('shotBar');
  var barSize = document.getElementById('shotBarSize');
  var hint = document.getElementById('shotHint');
  var retryBtn = document.getElementById('shotRetry');
  var cancelBtn = document.getElementById('shotCancel');
  var confirmBtn = document.getElementById('shotConfirm');

  var state = { dragging: false, start: null, rect: null, displayId: params.get('id') || '' };

  platform.shot.onImage(function (payload) {
    if (!payload) return;
    if (payload.url) bg.src = payload.url;
    if (payload.label) hint.textContent = payload.label + ' · Esc 取消';
  });

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function updateBox(x, y) {
    if (!state.start) return;
    var left = Math.min(state.start.x, x);
    var top = Math.min(state.start.y, y);
    var w = Math.abs(x - state.start.x);
    var h = Math.abs(y - state.start.y);
    state.rect = { x: left, y: top, w: w, h: h };
    box.hidden = false;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    var text = Math.round(w) + ' × ' + Math.round(h);
    sizeLabel.textContent = text;
    barSize.textContent = text;
  }

  function positionBar(rect) {
    bar.hidden = false;
    var bw = bar.offsetWidth;
    var bh = bar.offsetHeight;
    var left = clamp(rect.x + rect.w - bw, 12, innerWidth - bw - 12);
    var top = rect.y + rect.h + 12;
    if (top + bh > innerHeight - 12) top = Math.max(12, rect.y - bh - 12);
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }

  function reset() {
    state.rect = null;
    state.start = null;
    box.hidden = true;
    bar.hidden = true;
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.shot-bar')) return;
    if (e.button !== undefined && e.button !== 0) return;
    state.dragging = true;
    state.start = { x: e.clientX, y: e.clientY };
    state.rect = null;
    bar.hidden = true;
    updateBox(e.clientX, e.clientY);
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });

  document.addEventListener('pointermove', function (e) {
    if (!state.dragging) return;
    updateBox(e.clientX, e.clientY);
  });

  document.addEventListener('pointerup', function () {
    if (!state.dragging) return;
    state.dragging = false;
    if (!state.rect || state.rect.w < 8 || state.rect.h < 8) {
      reset();
      return;
    }
    positionBar(state.rect);
  });

  retryBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    reset();
  });

  cancelBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    platform.shot.cancel();
  });

  confirmBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!state.rect || state.rect.w < 8 || state.rect.h < 8) {
      reset();
      return;
    }
    platform.shot.confirm({
      displayId: state.displayId,
      rect: {
        x: Math.round(state.rect.x),
        y: Math.round(state.rect.y),
        w: Math.round(state.rect.w),
        h: Math.round(state.rect.h)
      }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      platform.shot.cancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    }
  });
})();
