import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { effectScope } from 'vue';
const require = createRequire(import.meta.url);
function compile(file, mocks) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => mocks[name] || require(name), module, module.exports);
  return module.exports;
}
function fixture(count = 3) {
  return {
    generatedAt: '2026-10-02T00:00:00Z', siteNodeIds: { me: 'n0' },
    nodes: Array.from({ length: count }, (_, i) => ({ summary: { nodeId: `n${i}`, name: `Site ${i}`, primarySite: { siteId: i === 0 ? 'me' : `s${i}` } } })),
    nodeLinks: Array.from({ length: count }, (_, i) => ({ sourceNodeId: `n${i}`, friendLinks: [{ id: `l${i}`, title: 'Friend', url: `https://s${(i+1)%count}.example`, targetRegistered: true, targetNodeId: `n${(i+1)%count}` }] }))
  };
}
function harness() {
  const requests = [];
  const mod = compile('../src/composables/useRelationGraph.ts', { '../api/graph': { fetchGraphTopology: signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })) } });
  const scope = effectScope();
  const store = scope.run(() => mod.useRelationGraph());
  return { ...mod, store, scope, requests };
}
test('1000 and 5001 nodes retain all relations using one request', async () => {
  for (const count of [1000, 5001]) {
    const h = harness(), run = h.store.reset('me');
    assert.equal(h.requests.length, 1);
    h.requests[0].resolve(fixture(count)); await run;
    assert.equal(h.store.nodes.value.size, count);
    assert.equal(h.store.edges.value.size, count);
    assert.equal(h.store.nodes.value.get('n0').kind, 'self');
    assert.equal(h.store.progress.value.capped, false);
    h.scope.stop();
  }
});
test('superseded success/error cannot overwrite latest request', async () => {
  for (const fail of [false, true]) {
    const h = harness(), first = h.store.reset('me'), second = h.store.reset('me');
    assert.equal(h.requests[0].signal.aborted, true);
    if (fail) h.requests[0].reject(new Error('old')); else h.requests[0].resolve(fixture(4));
    await first;
    assert.equal(h.store.loading.value, true);
    assert.equal(h.store.nodes.value.size, 0);
    assert.equal(h.store.error.value, '');
    h.requests[1].resolve(fixture(5)); await second;
    assert.equal(h.store.nodes.value.size, 5);
    h.scope.stop();
  }
});
test('unmount cancels request and ignores late response', async () => {
  const h = harness(), run = h.store.reset('me'); h.scope.stop();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve(fixture()); await run;
  assert.equal(h.store.nodes.value.size, 0);
});
test('refresh failure labels stale data; identity change clears it', async () => {
  const h = harness(); let run = h.store.reset('me');
  h.requests[0].resolve(fixture()); await run;
  run = h.store.reset('me'); h.requests[1].reject(new Error('offline')); await run;
  assert.equal(h.store.nodes.value.size, 3);
  assert.match(h.store.error.value, /上次成功加载的数据/);
  run = h.store.reset('other'); assert.equal(h.store.nodes.value.size, 0);
  h.requests[2].resolve(fixture()); await run;
  assert.match(h.store.error.value, /尚未建立/); h.scope.stop();
});
test('active-site identity, external nodes, duplicate edges and invalid source', () => {
  const h = harness(), data = fixture(); data.siteNodeIds = {};
  data.nodes[0].summary.primarySite.siteId = 'another';
  data.nodes[0].summary.activeSites = [{ siteId: 'me' }];
  data.nodeLinks[1].friendLinks.push({ targetRegistered: true, targetNodeId: 'n0' });
  data.nodeLinks[0].friendLinks.push({ id: 'external', title: 'Outside', url: 'https://outside.example/', targetRegistered: false });
  const result = h.buildGraphSnapshot(data, 'me');
  assert.equal(result.selfId, 'n0'); assert.equal(result.nodes.size, 4); assert.equal(result.edges.size, 4);
  data.nodeLinks.push({ sourceNodeId: 'missing', friendLinks: [] });
  assert.throws(() => h.buildGraphSnapshot(data, 'me'), /不完整/); h.scope.stop();
});
test('API uses existing topology proxy and rejects errors/malformed payload', async () => {
  let result = { success: true, data: fixture() }, call;
  const graph = compile('../src/api/graph.ts', { './client': { api: { post: async (...args) => { call = args; return result; } } } });
  const controller = new AbortController();
  assert.equal((await graph.fetchGraphTopology(controller.signal)).nodes.length, 3);
  assert.deepEqual(call, ['/hub/get', { path: '/v1/graph/topology', query: {} }, controller.signal]);
  result = { success: false, message: 'unauthorized' }; await assert.rejects(graph.fetchGraphTopology(), /unauthorized/);
  result = { success: true, data: {} }; await assert.rejects(graph.fetchGraphTopology(), /格式异常/);
});

test('WP transport sends nonce, keeps credentials local and forwards cancellation', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  try {
    globalThis.window = { __AH_BOOTSTRAP_LOGGED: true, location: { origin: 'https://wp.example' }, WP_ASTRAHUB_BOOTSTRAP: { restBase: '/wp-json/wp-astrahub/v1', restNonce: 'test-nonce' } };
    let sent;
    globalThis.fetch = async (url, init) => {
      sent = { url, init };
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: fixture() }) };
    };
    const { api } = compile('../src/api/client.ts', {});
    const controller = new AbortController();
    const result = await api.post('/hub/get', { path: '/v1/graph/topology', query: {} }, controller.signal);
    assert.equal(result.success, true);
    assert.equal(sent.url, 'https://wp.example/wp-json/wp-astrahub/v1/hub/get?_wpnonce=test-nonce');
    assert.equal(sent.init.signal, controller.signal);
    assert.equal(sent.init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(sent.init.body), { path: '/v1/graph/topology', query: {} });
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});
