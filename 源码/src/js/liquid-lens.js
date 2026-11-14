/* ============================================================
   Liquid Lens — SVG 位移滤镜 + 圆角矩形 SDF 位移贴图生成器
   来自 liquid-glass-ui，用于主面板边缘的真实折射
   ============================================================ */
(function (global) {
  'use strict';
  var DEFAULTS = {
    size: 420,        // 位移贴图长边像素
    rim: 0.118,       // 折射带宽度（相对短边半径）
    corner: 32,       // 圆角兜底值，实际以元素计算样式为准
    scale: 88,        // 基准位移强度，实际最大位移约为其一半
    aberration: 0.82, // 蓝通道位移比例，用来做色散
    blur: 2.5,        // 背景模糊
    sat: 180,         // 背景饱和度
    debounce: 160
  };

  var SEQ = 0;

  function ensureFilter(filterId) {
    var mapId = filterId + '-map';
    var existing = document.getElementById(mapId);
    if (existing) return existing;
    var holder = document.createElement('div');
    /* 三次位移分别取 R/G/B 通道再 screen 叠加；
       位移量依次递减，边缘就会出现红蓝分离的色散。 */
    holder.innerHTML =
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
        '<filter id="' + filterId + '" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">' +
          '<feImage id="' + mapId + '" result="MAP" preserveAspectRatio="none" href=""></feImage>' +
          '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="-72" xChannelSelector="R" yChannelSelector="G" result="dispR"></feDisplacementMap>' +
          '<feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chR"></feColorMatrix>' +
          '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="-68" xChannelSelector="R" yChannelSelector="G" result="dispG"></feDisplacementMap>' +
          '<feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chG"></feColorMatrix>' +
          '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="-62" xChannelSelector="R" yChannelSelector="G" result="dispB"></feDisplacementMap>' +
          '<feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chB"></feColorMatrix>' +
          '<feBlend in="chG" in2="chB" mode="screen" result="chGB"></feBlend>' +
          '<feBlend in="chR" in2="chGB" mode="screen"></feBlend>' +
        '</filter>' +
      '</svg>';
    document.body.insertBefore(holder.firstElementChild, document.body.firstChild);
    return document.getElementById(mapId);
  }

  function setFilterScale(filterId, scale, aberration) {
    var filter = document.getElementById(filterId);
    if (!filter) return;
    var maps = filter.querySelectorAll('feDisplacementMap');
    if (maps.length < 3) return;
    maps[0].setAttribute('scale', String(-scale));
    maps[1].setAttribute('scale', String(-scale * (1 - (1 - aberration) * 0.4)));
    maps[2].setAttribute('scale', String(-scale * aberration));
  }

  function supportsLens() {
    if (!global.CSS || typeof CSS.supports !== 'function') return false;
    return CSS.supports('filter', 'url(#liquidLens)');
  }

  function mountLiquidLens(target, options) {
    if (!target) return null;
    var opt = {};
    Object.keys(DEFAULTS).forEach(function (k) { opt[k] = DEFAULTS[k]; });
    if (options && typeof options === 'object') {
      Object.keys(options).forEach(function (k) { opt[k] = options[k]; });
    }
    if (!supportsLens()) return null;

    var filterId = 'lgLens' + (++SEQ);
    var feImg = ensureFilter(filterId);
    if (!feImg) return null;
    setFilterScale(filterId, opt.scale, opt.aberration);

    var warp = target.querySelector(':scope > .panel-warp');
    if (!warp) {
      warp = document.createElement('div');
      warp.className = 'panel-warp';
      target.insertBefore(warp, target.firstChild);
    }
    warp.style.filter = 'url(#' + filterId + ')';
    target.style.setProperty('--lens-blur', opt.blur + 'px');
    target.style.setProperty('--lens-sat', opt.sat + '%');
    document.documentElement.classList.add('lens-ready');

    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d');
    var smooth = function (a, b, x) {
      var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    function render() {
      var w = target.offsetWidth;
      var h = target.offsetHeight;
      if (!(w > 8 && h > 8)) return;
      var aspect = w / h;
      var W = aspect >= 1 ? opt.size : Math.max(64, Math.round(opt.size * aspect));
      var H = aspect >= 1 ? Math.max(64, Math.round(opt.size / aspect)) : opt.size;
      cv.width = W;
      cv.height = H;
      var im = ctx.createImageData(W, H);
      var px = im.data;
      /* 圆角跟着元素实际样式走，避免不同圆角的浮层共用一套折射 */
      var radius = parseFloat(getComputedStyle(target).borderTopLeftRadius);
      if (!(radius > 0)) radius = opt.corner;
      var r = Math.min(0.85, (radius / Math.min(w, h)) * 2);
      for (var j = 0; j < H; j++) {
        var v = (j / (H - 1)) * 2 - 1;
        var ay = Math.abs(v);
        for (var i = 0; i < W; i++) {
          var u = (i / (W - 1)) * 2 - 1;
          var ax = Math.abs(u);
          var qx = ax - (1 - r);
          var qy = ay - (1 - r);
          var sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
          var nx, ny;
          if (qx > 0 && qy > 0) {
            var l = Math.hypot(qx, qy) || 1;
            nx = (u >= 0 ? qx : -qx) / l;
            ny = (v >= 0 ? qy : -qy) / l;
          } else if (qx > qy) {
            nx = u >= 0 ? 1 : -1;
            ny = 0;
          } else {
            nx = 0;
            ny = v >= 0 ? 1 : -1;
          }
          var env = smooth(-opt.rim, -opt.rim * 0.12, sd) * (1 - smooth(0, opt.rim * 0.55, sd));
          var k = env * 0.92;
          var idx = (j * W + i) * 4;
          px[idx] = 128 + 127 * k * nx;
          px[idx + 1] = 128 + 127 * k * ny;
          px[idx + 2] = 128;
          px[idx + 3] = 255;
        }
      }
      ctx.putImageData(im, 0, 0);
      feImg.setAttribute('href', cv.toDataURL());
    }

    render();
    var observer = null;
    var timer = 0;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(function () {
        clearTimeout(timer);
        timer = setTimeout(render, opt.debounce);
      });
      observer.observe(target);
    }

    /* 鼠标位置驱动镜面高光，参数以 -1..1 写进 CSS 变量 */
    var raf = 0;
    var lastX = 0;
    var lastY = 0;
    function onPointerMove(e) {
      lastX = e.clientX;
      lastY = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var b = target.getBoundingClientRect();
        if (!b.width || !b.height) return;
        var mx = Math.max(-1, Math.min(1, ((lastX - b.left) / b.width) * 2 - 1));
        var my = Math.max(-1, Math.min(1, ((lastY - b.top) / b.height) * 2 - 1));
        target.style.setProperty('--mx', mx.toFixed(3));
        target.style.setProperty('--my', my.toFixed(3));
      });
    }
    target.addEventListener('pointermove', onPointerMove, { passive: true });

    return {
      render: render,
      destroy: function () {
        if (observer) observer.disconnect();
        clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        target.removeEventListener('pointermove', onPointerMove);
        if (warp && warp.parentNode) warp.parentNode.removeChild(warp);
        var filter = document.getElementById(filterId);
        if (filter && filter.parentNode && filter.parentNode.parentNode) {
          filter.parentNode.parentNode.removeChild(filter.parentNode);
        }
        document.documentElement.classList.remove('lens-ready');
      }
    };
  }
  global.mountLiquidLens = mountLiquidLens;
})(window);
