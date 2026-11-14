'use strict';
const endpoint = process.argv[2] || 'http://127.0.0.1:9341';
const action = process.argv[3] || 'inspect';

class Client {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.counter = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
  }
  async call(method, params = {}) {
    await this.ready;
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  close() { this.socket.close(); }
}

async function main() {
  const pages = await (await fetch(endpoint + '/json/list')).json();
  const control = pages.find(page => page.url.includes('index.html'));
  if (!control) throw new Error('Missing application page');
  const client = new Client(control.webSocketDebuggerUrl);
  try {
    if (action === 'enable') {
      console.log(await client.evaluate(`(async function () {
        const info = await platform.app.info();
        if (!info.userData.includes('.packaged-pet-check')) throw new Error('Unexpected profile');
        const state = await platform.state.get();
        state.settings.petEnabled = true;
        state.settings.clipboardWatch = false;
        state.pets.forEach(pet => { pet.enabled = true; });
        return platform.state.set(state);
      })()`));
    } else if (action === 'quit') {
      await client.evaluate('platform.window.quit()').catch(() => {});
      return;
    } else {
      console.log(JSON.stringify(await client.evaluate(`Promise.all([platform.app.info(), platform.state.get()]).then(([info, state]) => ({
        info, enabled: state.settings.petEnabled, pets: state.pets.map(pet => ({id:pet.id,enabled:pet.enabled,avatarUrl:pet.avatarUrl,x:pet.x,y:pet.y}))
      }))`), null, 2));
    }
  } finally { client.close(); }
  await new Promise(resolve => setTimeout(resolve, 700));
  const targets = await (await fetch(endpoint + '/json/list')).json();
  console.log('Pages: ' + JSON.stringify(targets.map(page => ({ id: page.id, url: page.url })), null, 2));
  for (const page of targets.filter(page => page.url.includes('pet.html'))) {
    const pet = new Client(page.webSocketDebuggerUrl);
    try {
      console.log('Pet: ' + JSON.stringify(await pet.evaluate(`({
        id:platform.env.petId, image:document.querySelector('#petFace').src, loaded:document.querySelector('#petFace').naturalWidth,
        bounds:{x:screenX,y:screenY,width:innerWidth,height:innerHeight}, visibility:document.visibilityState, body:getComputedStyle(document.body).display
      })`), null, 2));
    } finally { pet.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
