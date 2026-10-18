import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ENGINES,
  buildSearchUrl,
  createDefaultState,
  deriveBadge,
  faviconIcoCandidates,
  faviconPageUrl,
  hasPlaceholder,
  iconSourcesFor,
  loadState,
  moveItem,
  normalizeColor,
  normalizeTemplate,
  parseImport,
  resolveActiveEngine,
  sanitizeBadge,
  sanitizeIcon,
  sanitizeState,
  serializeConfig,
  STORAGE_KEY,
} from '../src/common.js';

const engine = (overrides = {}) => ({ id: 'x', name: 'X', url: 'https://x.test/?q=%s', ...overrides });

test('默认配置：10 个启用引擎，模板统一用 %s', () => {
  const state = createDefaultState();
  assert.equal(state.engines.length, DEFAULT_ENGINES.length);
  assert.ok(state.engines.every((item) => item.enabled));
  assert.ok(state.engines.every((item) => item.url.includes('%s') && !item.url.includes('{q}')));
  assert.ok(state.engines.every((item) => item.icon === ''));
  assert.equal(resolveActiveEngine(state).id, 'bing');
  assert.equal(state.showEngineIcons, true);
  assert.equal(new Set(state.engines.map((item) => item.id)).size, state.engines.length);
});

test('createDefaultState 每次返回独立副本', () => {
  const first = createDefaultState();
  first.engines[0].name = '被改掉了';
  const second = createDefaultState();
  assert.equal(second.engines[0].name, 'Bing');
  assert.equal(DEFAULT_ENGINES[0].name, 'Bing');
});

test('buildSearchUrl 对关键词做 URL 编码', () => {
  assert.equal(
    buildSearchUrl('https://www.bing.com/search?q=%s', '你好 世界'),
    'https://www.bing.com/search?q=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C',
  );
  assert.equal(
    buildSearchUrl({ url: 'https://example.com/s?q=%s' }, ' a&b=c '),
    'https://example.com/s?q=a%26b%3Dc',
  );
});

test('buildSearchUrl 兼容旧的 {q} 占位符', () => {
  assert.equal(buildSearchUrl('https://example.com/?q={q}', 'ok'), 'https://example.com/?q=ok');
});

test('buildSearchUrl 在缺少占位符时抛错', () => {
  assert.throws(() => buildSearchUrl('https://example.com/', 'x'), /%s/);
  assert.throws(() => buildSearchUrl({}, 'x'), /%s/);
});

test('normalizeTemplate 只接受 http(s) + %s，并把 {q} 迁移成 %s', () => {
  assert.equal(normalizeTemplate('  https://www.google.com/search?q=%s  '), 'https://www.google.com/search?q=%s');
  assert.equal(normalizeTemplate('https://a.test/?q=%s\n'), 'https://a.test/?q=%s');
  assert.equal(normalizeTemplate('https://a.test/?q={q}'), 'https://a.test/?q=%s');
  assert.equal(normalizeTemplate('ftp://a.test/?q=%s'), '');
  assert.equal(normalizeTemplate('javascript:alert(1)?q=%s'), '');
  assert.equal(normalizeTemplate('https://a.test/search'), '');
  assert.equal(normalizeTemplate(''), '');
  assert.ok(hasPlaceholder('https://a.test/?q=%s'));
  assert.ok(hasPlaceholder('https://a.test/?q={q}'));
  assert.ok(!hasPlaceholder('https://a.test/'));
});

test('sanitizeState 丢弃坏引擎并补全默认值', () => {
  const state = sanitizeState({
    engines: [
      { id: 'ok', name: '  正常  ', url: 'https://ok.test/?q=%s', badge: '', color: 'nope' },
      { id: 'bad-url', name: '坏的', url: 'https://bad.test/no-placeholder' },
      { url: 'https://no-id.test/?q=%s', name: '没有 id' },
      null,
      'garbage',
    ],
    activeEngineId: 'ok',
    openInNewTab: false,
  });

  assert.equal(state.engines.length, 2);
  assert.equal(state.engines[0].name, '正常');
  assert.equal(state.engines[0].badge, '正');
  assert.equal(state.engines[0].color, '#64748b');
  assert.equal(state.engines[0].icon, '');
  assert.ok(state.engines[1].id.startsWith('engine-'));
  assert.equal(state.activeEngineId, 'ok');
  assert.equal(state.openInNewTab, false);
  assert.equal(state.prefillSelection, true);
  assert.equal(state.showEngineIcons, true);
});

test('sanitizeState 去重 id，并保证至少一个引擎启用', () => {
  const state = sanitizeState({
    engines: [
      engine({ id: 'dup', name: 'A', enabled: false }),
      engine({ id: 'dup', name: 'B', enabled: false }),
    ],
  });

  assert.equal(state.engines.length, 2);
  assert.notEqual(state.engines[0].id, state.engines[1].id);
  assert.ok(state.engines.some((item) => item.enabled));
  assert.ok(state.engines.find((item) => item.id === state.activeEngineId).enabled);
});

test('sanitizeState 修正指向已停用引擎的默认项', () => {
  const state = sanitizeState({
    engines: [
      engine({ id: 'a', name: 'A', enabled: false }),
      engine({ id: 'b', name: 'B', enabled: true }),
    ],
    activeEngineId: 'a',
  });
  assert.equal(state.activeEngineId, 'b');
});

test('sanitizeState 对空数据回落到默认配置', () => {
  assert.equal(sanitizeState(null).engines.length, DEFAULT_ENGINES.length);
  assert.equal(sanitizeState({ engines: [] }).engines.length, DEFAULT_ENGINES.length);
  assert.equal(sanitizeState({ engines: [{ url: 'bad' }] }).engines.length, DEFAULT_ENGINES.length);
});

test('sanitizeState 迁移旧配置里的 {q} 模板并保留自定义图标', () => {
  const state = sanitizeState({
    engines: [{ id: 'old', name: '旧引擎', url: 'https://old.test/?q={q}', icon: 'https://old.test/logo.png' }],
    showEngineIcons: false,
  });
  assert.equal(state.engines[0].url, 'https://old.test/?q=%s');
  assert.equal(state.engines[0].icon, 'https://old.test/logo.png');
  assert.equal(state.showEngineIcons, false);
});

test('sanitizeIcon 只接受 http(s)', () => {
  assert.equal(sanitizeIcon(' https://a.test/i.png '), 'https://a.test/i.png');
  assert.equal(sanitizeIcon(''), '');
  assert.equal(sanitizeIcon('javascript:alert(1)'), '');
  assert.equal(sanitizeIcon('data:image/png;base64,AAAA'), '');
});

test('faviconPageUrl 取 origin，非法地址返回空', () => {
  assert.equal(faviconPageUrl('https://www.bing.com/search?q=%s'), 'https://www.bing.com');
  assert.equal(faviconPageUrl('https://search.bilibili.com/all?keyword=%s'), 'https://search.bilibili.com');
  assert.equal(faviconPageUrl('not a url'), '');
  assert.equal(faviconPageUrl('ftp://a.test/?q=%s'), '');
});

test('faviconIcoCandidates：推导 /favicon.ico 并做子域名回退', () => {
  assert.deepEqual(
    faviconIcoCandidates({ url: 'https://www.bing.com/search?q=%s' }),
    ['https://www.bing.com/favicon.ico', 'https://bing.com/favicon.ico'],
  );

  assert.deepEqual(
    faviconIcoCandidates({ url: 'https://search.bilibili.com/all?keyword=%s' }),
    [
      'https://search.bilibili.com/favicon.ico',
      'https://www.bilibili.com/favicon.ico',
      'https://bilibili.com/favicon.ico',
    ],
  );

  // http 模板也统一走 https，避免扩展页面里的混合内容
  assert.deepEqual(
    faviconIcoCandidates({ url: 'http://example.com/?q=%s' }),
    ['https://example.com/favicon.ico'],
  );

  assert.deepEqual(faviconIcoCandidates({ url: 'not a url' }), []);
  assert.deepEqual(faviconIcoCandidates('ftp://a.test/?q=%s'), []);
});

test('iconSourcesFor：官方图标接口优先，/favicon.ico 兜底', () => {
  assert.deepEqual(
    iconSourcesFor({ url: 'https://www.bing.com/search?q=%s' }),
    [
      { type: 'favicon', pageUrl: 'https://www.bing.com' },
      { type: 'remote', url: 'https://www.bing.com/favicon.ico' },
      { type: 'remote', url: 'https://bing.com/favicon.ico' },
    ],
  );
});

test('iconSourcesFor：自定义图标优先，关闭图标时返回空', () => {
  assert.deepEqual(
    iconSourcesFor({ url: 'https://www.bing.com/search?q=%s', icon: 'https://cdn.test/bing.png' }),
    [{ type: 'remote', url: 'https://cdn.test/bing.png' }],
  );
  assert.deepEqual(iconSourcesFor(null), []);
  assert.deepEqual(
    iconSourcesFor({ url: 'https://www.bing.com/search?q=%s' }, { allowIcons: false }),
    [],
  );
});

test('moveItem 支持上移、下移与越界', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(list, 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(list, 1, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(list, -1, 0), ['a', 'b', 'c']);
  assert.deepEqual(moveItem(list, 0, 99), ['b', 'c', 'a']);
  assert.deepEqual(list, ['a', 'b', 'c'], '不应修改原数组');
});

test('deriveBadge / sanitizeBadge 规则', () => {
  assert.equal(deriveBadge('360 搜索'), '360');
  assert.equal(deriveBadge('DuckDuckGo'), 'D');
  assert.equal(deriveBadge('百度'), '百');
  assert.equal(deriveBadge(''), '?');
  assert.equal(sanitizeBadge(' gh ', 'GitHub'), 'GH');
  assert.equal(sanitizeBadge('', '哔哩哔哩'), '哔');
  assert.equal(sanitizeBadge('abcd', 'X'), 'ABC');
});

test('normalizeColor 支持 #rgb / #rrggbb，其余回落', () => {
  assert.equal(normalizeColor('#ABC'), '#aabbcc');
  assert.equal(normalizeColor('#123456'), '#123456');
  assert.equal(normalizeColor('red'), '#64748b');
  assert.equal(normalizeColor(undefined, '#000000'), '#000000');
});

test('resolveActiveEngine 在极端状态下仍有兜底', () => {
  assert.equal(resolveActiveEngine(null), null);
  assert.equal(resolveActiveEngine({ engines: [], activeEngineId: 'x' }), null);

  const disabled = {
    engines: [engine({ id: 'a', enabled: false })],
    activeEngineId: 'a',
  };
  assert.equal(resolveActiveEngine(disabled).id, 'a');
});

test('serializeConfig / parseImport 往返一致', () => {
  const state = createDefaultState();
  const payload = JSON.stringify(serializeConfig(state));

  const parsed = parseImport(payload);
  assert.deepEqual(parsed, state);

  const bare = parseImport(JSON.stringify(state.engines));
  assert.equal(bare.engines.length, state.engines.length);

  assert.throws(() => parseImport('不是 json'), /JSON/);
  assert.throws(() => parseImport('{"foo":1}'), /engines/);
});

test('导入旧格式（{q} 占位符）会自动迁移', () => {
  const parsed = parseImport(JSON.stringify({
    state: {
      engines: [
        { name: '保留', url: 'https://keep.test/?q={q}' },
        { name: '丢弃', url: 'not-a-url' },
      ],
    },
  }));
  assert.equal(parsed.engines.length, 1);
  assert.equal(parsed.engines[0].name, '保留');
  assert.equal(parsed.engines[0].url, 'https://keep.test/?q=%s');
});

test('loadState 首次运行写入默认配置（模拟 chrome.storage）', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      sync: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(items) {
          Object.assign(store, items);
        },
      },
    },
  };

  const state = await loadState();
  assert.equal(state.engines.length, DEFAULT_ENGINES.length);
  assert.ok(store[STORAGE_KEY], '应写入存储');
  assert.equal(store[STORAGE_KEY].activeEngineId, 'bing');
  assert.ok(store[STORAGE_KEY].engines.every((item) => item.url.includes('%s')));

  delete globalThis.chrome;
});
