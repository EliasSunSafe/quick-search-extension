/**
 * 弹出面板的冒烟测试：用一套极简 DOM 桩跑通「初始化 → 输入 → 切换 → 搜索」。
 * 目的不是替代浏览器测试，而是尽早发现找不到元素、事件没接上、URL 拼错这类问题。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

class ClassList {
  constructor() {
    this.items = new Set();
  }

  add(...names) {
    for (const name of names) this.items.add(name);
  }

  remove(...names) {
    for (const name of names) this.items.delete(name);
  }

  contains(name) {
    return this.items.has(name);
  }

  toggle(name, force) {
    const on = force === undefined ? !this.items.has(name) : Boolean(force);
    if (on) this.items.add(name);
    else this.items.delete(name);
    return on;
  }
}

class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.classList = new ClassList();
    this.dataset = {};
    this.style = { setProperty: () => {} };
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.title = '';
    this.disabled = false;
    this.parent = null;
  }

  get className() {
    return [...this.classList.items].join(' ');
  }

  set className(value) {
    this.classList.items = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ preventDefault() {}, target: this, ...event });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  focus() {}

  select() {}

  closest(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    let node = this;
    while (node) {
      if (node.classList && node.classList.contains(className)) return node;
      node = node.parent;
    }
    return null;
  }
}

function createEnvironment() {
  const ids = ['searchForm', 'query', 'engines', 'currentEngine', 'newTab', 'status', 'openOptions'];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement('div', id)]));
  const documentListeners = new Map();

  globalThis.document = {
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, handler) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
  };

  const calls = { created: [], updated: [], closed: 0 };
  const store = {};

  globalThis.window = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    close: () => {
      calls.closed += 1;
    },
  };

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
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://example.com' }];
      },
      async create(properties) {
        calls.created.push(properties.url);
        return { id: 8 };
      },
      async update(id, properties) {
        calls.updated.push({ id, url: properties.url });
        return { id };
      },
    },
    scripting: {
      async executeScript() {
        return [{ result: '页面选中文字' }];
      },
    },
    runtime: {
      openOptionsPage() {
        calls.options = (calls.options ?? 0) + 1;
      },
      getURL(path) {
        return `chrome-extension://test-extension-id/${path}`;
      },
    },
  };

  return { elements, documentListeners, calls, store };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

function pressKey(documentListeners, key, extra = {}) {
  for (const handler of documentListeners.get('keydown') ?? []) {
    handler({
      key,
      code: `Digit${key}`,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
      ...extra,
    });
  }
}

test('弹出面板冒烟：初始化 → 输入 → 切换 → 搜索', async (t) => {
  const env = createEnvironment();
  await import('../src/popup.js');
  await flush();

  const { elements, calls, store } = env;

  await t.test('初始化后渲染 10 个引擎并填入选中文本', () => {
    assert.equal(elements.engines.children.length, 10);
    assert.equal(elements.currentEngine.textContent, 'Bing');
    assert.equal(elements.query.value, '页面选中文字');
    assert.equal(elements.newTab.checked, true);
    assert.equal(elements.engines.children[0].dataset.id, 'bing');
    assert.ok(elements.engines.children[0].classList.contains('is-active'));

    const icon = elements.engines.children[0].children[0];
    assert.equal(icon.className, 'engine-icon');
    assert.equal(icon.dataset.len, '1');
    assert.equal(icon.children[0].textContent, 'B');

    const image = icon.children[1];
    // 官方图标接口优先：_favicon
    assert.equal(
      image.src,
      'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fwww.bing.com&size=32',
    );
    // 官方图标加载失败时，回退到站点的 /favicon.ico
    image.dispatch('error');
    assert.equal(image.src, 'https://www.bing.com/favicon.ico');

    // 快捷号码牌已随快捷键一起移除，卡片只剩图标和名称
    assert.equal(elements.engines.children[0].children.length, 2);
  });

  await t.test('空关键词回车不会打开页面，只提示', async () => {
    elements.query.value = '   ';
    elements.searchForm.dispatch('submit');
    await flush();
    assert.equal(calls.created.length, 0);
    assert.ok(elements.searchForm.classList.contains('is-shaking'));
  });

  await t.test('回车用当前引擎搜索并编码关键词', async () => {
    elements.query.value = '你好 世界';
    elements.searchForm.dispatch('submit');
    await flush();
    assert.equal(calls.created.at(-1), 'https://www.bing.com/search?q=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C');
    assert.equal(calls.closed, 1);
  });

  await t.test('Alt+数字 不再触发搜索（快捷键已移除）', async () => {
    const before = calls.created.length;
    const activeBefore = store.quickSearchState.activeEngineId;
    elements.query.value = 'edge';
    pressKey(env.documentListeners, '2', { altKey: true });
    await flush();
    assert.equal(calls.created.length, before);
    assert.equal(store.quickSearchState.activeEngineId, activeBefore);
  });

  await t.test('空关键词时点击卡片只切换引擎', async () => {
    const before = calls.created.length;
    elements.query.value = '';
    const baidu = elements.engines.children.find((chip) => chip.dataset.id === 'baidu');
    elements.engines.dispatch('click', { target: baidu });
    await flush();
    assert.equal(calls.created.length, before);
    assert.equal(elements.currentEngine.textContent, '百度');
    assert.equal(store.quickSearchState.activeEngineId, 'baidu');
    assert.ok(elements.status.textContent.includes('百度'));
  });

  await t.test('有内容时点击卡片会立刻用新引擎重搜', async () => {
    elements.query.value = 'chrome';
    const bing = elements.engines.children.find((chip) => chip.dataset.id === 'bing');
    elements.engines.dispatch('click', { target: bing });
    await flush();
    assert.equal(calls.created.at(-1), 'https://www.bing.com/search?q=chrome');
    assert.equal(store.quickSearchState.activeEngineId, 'bing');
  });

  await t.test('点击齿轮打开设置页', async () => {
    elements.openOptions.dispatch('click');
    await flush();
    assert.equal(calls.options, 1);
  });
});
