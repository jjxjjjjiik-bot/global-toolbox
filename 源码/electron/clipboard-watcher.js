'use strict';

const crypto = require('crypto');
const { clipboard, nativeImage } = require('electron');

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function imageSignature(buffer) {
  return 'i:' + buffer.length + ':' + hash(buffer);
}

function textSignature(text) {
  return 't:' + hash(text);
}

/* Electron 44 起 clipboard 换成 W3C 异步 API：没有 availableFormats/readImage，
   图片要从 clipboard.read() 的 ClipboardItem 里按 image/* 取 Blob。 */
class ClipboardWatcher {
  constructor(options) {
    this.getState = options.getState;
    this.onEntry = options.onEntry;
    this.timer = null;
    this.suspendUntil = 0;
    this.lastSig = '';
    this.busy = false;
    this.pollMs = 800;
    this.primed = false;
    this.revision = 0;
  }

  start() {
    this.stop();
    this.primed = false;
    this.lastSig = '';
    this.prime();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  /* 启动时先记住当前剪贴板内容，避免把历史内容当成新复制 */
  async prime() {
    const payload = await this.snapshot();
    this.lastSig = payload ? payload.sig : '';
    this.primed = true;
  }

  stop() {
    this.revision++;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  suspend(ms) {
    this.revision++;
    this.suspendUntil = Math.max(this.suspendUntil, Date.now() + (ms || 600));
  }

  mark(sig) {
    this.revision++;
    this.lastSig = sig || '';
  }

  async readImageBuffer() {
    let hasImage = false;
    try {
      hasImage = await clipboard.has('image/png');
    } catch (err) {
      hasImage = false;
    }
    if (!hasImage) return null;

    const items = await clipboard.read();
    for (const item of items) {
      const type = (item.types || []).find(function (mime) { return mime.indexOf('image/') === 0; });
      if (!type) continue;
      const blob = await item.getType(type);
      if (!blob || typeof blob.arrayBuffer !== 'function') continue;
      const raw = Buffer.from(await blob.arrayBuffer());
      if (!raw.length) continue;
      /* 统一转成 PNG，后续写回剪贴板和存盘都按 image/png 处理 */
      const image = nativeImage.createFromBuffer(raw);
      if (image && !image.isEmpty()) {
        const png = image.toPNG();
        if (png && png.length) return png;
      }
    }
    return null;
  }

  async snapshot() {
    try {
      const png = await this.readImageBuffer();
      if (png) {
        return { type: 'image', content: '', buffer: png, sig: imageSignature(png) };
      }
    } catch (err) {
      /* 图片读不到就退回文本 */
    }

    try {
      const text = await clipboard.readText();
      if (text && text.trim()) {
        return {
          type: 'text',
          content: String(text).slice(0, 20000),
          buffer: null,
          sig: textSignature(text)
        };
      }
    } catch (err) {
      /* 剪贴板被其他程序占用时忽略这一次 */
    }
    return null;
  }

  async poll() {
    if (this.busy || !this.primed) return;
    const state = this.getState();
    if (!state || !state.settings.clipboardWatch) return;
    if (Date.now() < this.suspendUntil) return;

    this.busy = true;
    const revision = this.revision;
    try {
      const payload = await this.snapshot();
      /* 写回历史记录时，之前已经开始的异步读取也必须作废。 */
      if (revision !== this.revision || Date.now() < this.suspendUntil) return;
      if (!payload) return;
      if (payload.sig === this.lastSig) return;
      this.lastSig = payload.sig;
      this.onEntry(payload);
    } catch (err) {
      /* 单次失败不打断监听 */
    } finally {
      this.busy = false;
    }
  }

  async readNow() {
    const payload = await this.snapshot();
    if (payload) this.lastSig = payload.sig;
    return payload;
  }
}

module.exports = { ClipboardWatcher, textSignature, imageSignature };
