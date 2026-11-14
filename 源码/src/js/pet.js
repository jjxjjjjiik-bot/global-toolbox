(function () {
  'use strict';

  var platform = window.platform;
  var root = document.getElementById('petRoot');
  var bubble = document.getElementById('petBubble');
  var line = document.getElementById('petLine');
  var face = document.getElementById('petFace');
  var pausedTag = document.getElementById('petPaused');

  var petId = (platform.env && platform.env.petId) || '';
  var audio = null;
  var bubbleTimer = null;
  var current = { playId: '', clip: null };
  var paused = false;

  function stopAudio() {
    if (audio) {
      try { audio.pause(); } catch (e) { /* ignore */ }
      audio = null;
    }
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    bubble.classList.remove('is-show');
    bubble.hidden = false;
    root.classList.remove('is-speaking');
  }

  function showBubble(text) {
    line.textContent = text || '';
    bubble.hidden = false;
    /* 强制重排，保证过渡动画每次都触发 */
    void bubble.offsetWidth;
    bubble.classList.add('is-show');
  }

  function finish(ok) {
    hideBubble();
    stopAudio();
    if (current.playId) {
      platform.pet.played({ playId: current.playId, ok: !!ok });
      current.playId = '';
    }
  }

  function play(clip) {
    if (!clip || !clip.url) {
      finish(false);
      return;
    }
    current.clip = clip;
    showBubble(clip.label || '');
    root.classList.add('is-speaking');
    stopAudio();
    audio = new Audio(clip.url);
    audio.volume = 1;
    var done = false;
    var guard = setTimeout(function () {
      if (!done) { done = true; finish(true); }
    }, Math.max(3000, (Number(clip.duration) || 5) * 1000 + 1200));

    audio.addEventListener('ended', function () {
      if (done) return;
      done = true;
      clearTimeout(guard);
      /* 说完再把气泡多留 600ms，方便看清字幕 */
      setTimeout(function () {
        hideBubble();
        root.classList.remove('is-speaking');
        if (current.playId) {
          platform.pet.played({ playId: current.playId, ok: true });
          current.playId = '';
        }
      }, 600);
    });
    audio.addEventListener('error', function () {
      if (done) return;
      done = true;
      clearTimeout(guard);
      finish(false);
    });
    var attempt = audio.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () { /* 自动播放被拦时仍按字幕时长走 guard */ });
    }
  }

  /* ==================== 交互 ==================== */
  var pointerDownAt = null;

  document.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    pointerDownAt = { x: e.clientX, y: e.clientY };
    document.body.classList.add('is-dragging');
    platform.pet.pointerDown(petId);
  });

  document.addEventListener('pointerup', function (e) {
    document.body.classList.remove('is-dragging');
    if (!pointerDownAt) return;
    pointerDownAt = null;
    platform.pet.pointerUp(petId).catch(function () { /* ignore */ });
  });

  document.addEventListener('wheel', function (e) {
    e.preventDefault();
    var delta = e.deltaY < 0 ? 20 : -20;
    platform.pet.resize(petId, delta);
  }, { passive: false });

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ==================== 主进程事件 ==================== */
  platform.pet.onInit(function (payload) {
    if (!payload || !payload.pet) return;
    var pet = payload.pet;
    paused = !!payload.paused;
    pausedTag.hidden = !paused && !pet.paused;
    if (pet.avatarUrl || pet.avatar) face.src = pet.avatarUrl || pet.avatar;
    if (pet.size) {
      face.style.width = '100%';
      face.style.height = '100%';
    }
  });

  platform.pet.onPaused(function (payload) {
    paused = !!(payload && payload.paused);
    pausedTag.hidden = !paused;
  });

  platform.pet.onSpeak(function (payload) {
    if (!payload || !payload.clip) return;
    current.playId = payload.playId || '';
    if (paused) {
      /* 暂停接话时只显示字幕，不出声 */
      showBubble(payload.clip.label || '');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () {
        hideBubble();
        if (current.playId) {
          platform.pet.played({ playId: current.playId, ok: true });
          current.playId = '';
        }
      }, 2400);
      return;
    }
    play(payload.clip);
  });

  platform.pet.onStop(function () {
    finish(false);
  });

  platform.pet.onSize(function (payload) {
    if (!payload || !payload.size) return;
    face.style.width = '100%';
    face.style.height = '100%';
  });
})();
