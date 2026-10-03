import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

test('realtime error reconnects; member/resync events propagate; stale tickets cannot connect', async () => {
  const source = readFileSync(new URL('../src/composables/useFriendInvitationRealtime.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const timers = new Map(), sockets = [], received = [], tickets = [];
  let sequence = 0, watcher;
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = {
    exports: {}, WebSocket: Socket, EventSource: class {}, console,
    setTimeout: (fn, ms) => { timers.set(++sequence, { fn, ms }); return sequence; },
    clearTimeout: id => timers.delete(id),
    require: name => name === 'vue' ? {
      watch: (_, callback) => { watcher = callback; callback(); }, onBeforeUnmount: () => {}
    } : {
      buildHubWsUrl: () => 'wss://test.example/ws', buildHubSseUrl: () => '',
      issueRealtimeToken: () => new Promise(resolve => tickets.push(resolve))
    }
  };
  vm.createContext(context); vm.runInContext(code, context);
  const site = { value: 'me' };
  const stream = context.exports.useFriendInvitationRealtime({ value: 'https://test.example' }, site, event => received.push(event.type));
  tickets[0]({ token: 'first' }); await new Promise(setImmediate);
  const socket = sockets[0]; socket.readyState = 1; socket.onopen();
  for (const type of ['world_chat_message_created', 'world_chat_member_updated', 'realtime_resync_required']) {
    socket.onmessage({ data: JSON.stringify({ type, data: { member: { siteId: 'peer' } } }) });
  }
  assert(received.includes('world_chat_member_updated'));
  assert(received.includes('realtime_resync_required'));
  socket.onerror();
  assert.equal([...timers.values()].filter(timer => timer.ms === 3000).length, 1);
  stream.reconnect(); site.value = 'other'; watcher();
  tickets[1]({ token: 'old' }); await new Promise(setImmediate);
  assert.equal(sockets.length, 1);
  stream.stop(); tickets[2]({ token: 'late' }); await new Promise(setImmediate);
  assert.equal(sockets.length, 1);
  assert.equal(timers.size, 0);
});
