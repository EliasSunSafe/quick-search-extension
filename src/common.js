/**
 * 快搜 · 共享核心模块
 *
 * 这里只放纯函数与存储封装；所有 chrome.* 访问都发生在函数内部，
 * 因此这个文件可以直接在 Node 里 import 做单元测试。
 */

export const APP_ID = 'quick-search';
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'quickSearchState';

/** 默认搜索引擎（id 稳定，便于设置页和右键菜单引用） */
export const DEFAULT_ENGINES = [
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', badge: 'B', color: '#0f7b6c' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', badge: 'G', color: '#4285f4' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s', badge: '百', color: '#2932e1' },
  { id: 'sogou', name: '搜狗', url: 'https://www.sogou.com/web?query=%s', badge: '搜', color: '#ff6a00' },
  { id: 'so360', name: '360 搜索', url: 'https://www.so.com/s?q=%s', badge: '360', color: '#1ab394' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', badge: 'D', color: '#de5833' },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=%s', badge: '知', color: '#0084ff' },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword=%s', badge: '哔', color: '#fb7299' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s', badge: 'GH', color: '#24292f' },
  { id: 'wikipedia', name: '维基百科', url: 'https://zh.wikipedia.org/w/index.php?search=%s', badge: 'W', color: '#54595d' },
];

const PLACEHOLDER_PATTERN = /%s|\{q\}/g;
const CJK_PATTERN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

export function createDefaultState() {
  return {
    version: SCHEMA_VERSION,
    engines: DEFAULT_ENGINES.map((engine) => ({ ...engine, icon: '', enabled: true })),
    activeEngineId: 'bing',
    openInNewTab: true,
    prefillSelection: true,
    enableContextMenu: true,
    showEngineIcons: true,
  };
}

export function hasPlaceholder(template) {
  return /%s|\{q\}/.test(String(template ?? ''));
}

/**
 * 校验并规范化搜索地址模板。
 * 只接受 http(s) 且必须包含 %s 占位符；旧的 {q} 会自动转成 %s。
 */
export function normalizeTemplate(template) {
  const raw = String(template ?? '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  const compact = raw.replace(/\s+/g, '');
  if (!hasPlaceholder(compact)) return '';
  return compact.replace(/\{q\}/g, '%s');
}

/** 用指定引擎构造搜索 URL；query 会被安全编码 */
export function buildSearchUrl(engineOrTemplate, query) {
  const template = typeof engineOrTemplate === 'string' ? engineOrTemplate : engineOrTemplate?.url;
  if (!template || !hasPlaceholder(template)) {
    throw new Error('搜索地址无效：需要包含 %s 占位符');
  }
  return String(template).replace(PLACEHOLDER_PATTERN, encodeURIComponent(String(query ?? '').trim()));
}

/** 生成一个足够唯一的 id（不依赖 crypto，便于测试） */
export function createId(prefix = 'engine') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function normalizeColor(value, fallback = '#64748b') {
  const raw = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split('').map((char) => char + char).join('')}`.toLowerCase();
  }
  return fallback;
}

/** 根据名称推导徽标：数字优先，中文取首字，拉丁字母取首字母 */
export function deriveBadge(name) {
  const text = String(name ?? '').trim();
  if (!text) return '?';
  const digits = text.match(/^\d{1,3}/);
  if (digits) return digits[0];
  const first = [...text][0];
  if (CJK_PATTERN.test(first)) return first;
  return first.toUpperCase();
}

export function sanitizeBadge(value, name) {
  const raw = String(value ?? '').trim();
  const badge = raw || deriveBadge(name);
  return [...badge].slice(0, 3).join('').toUpperCase();
}

/** 自定义图标地址：只接受 http(s)，空字符串表示“自动获取” */
export function sanitizeIcon(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\s+/g, '');
}

/** 官方图标接口用的 pageUrl：取搜索地址的 origin（不含路径与查询） */
export function faviconPageUrl(template) {
  const raw = String(template ?? '');
  let parsed;
  try {
    parsed = new URL(raw.replace(PLACEHOLDER_PATTERN, ''));
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  return parsed.origin;
}

/**
 * 按搜索地址推导站点的 /favicon.ico 候选（子域名会回退），
 * 统一走 https，避免扩展页面里的混合内容。
 */
export function faviconIcoCandidates(engineOrTemplate) {
  const template = typeof engineOrTemplate === 'string' ? engineOrTemplate : engineOrTemplate?.url;
  const pageUrl = faviconPageUrl(template);
  if (!pageUrl) return [];

  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return [];
  }

  const host = parsed.hostname.toLowerCase();
  const hosts = [host];
  const stripped = host.replace(/^(www|search|m)\./, '');
  if (stripped && stripped !== host) hosts.push(`www.${stripped}`, stripped);

  const candidates = [];
  const seen = new Set();
  for (const item of hosts) {
    const url = `https://${item}/favicon.ico`;
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push(url);
  }
  return candidates;
}

/**
 * 图标来源（按优先级）：
 * 1. { type: 'remote' } 用户自定义图标；
 * 2. { type: 'favicon' } 浏览器官方图标接口（_favicon，取站点声明的正式图标，走本地缓存）；
 * 3. { type: 'remote' } 站点 /favicon.ico 候选（官方图标取不到时的兜底）。
 * allowIcons=false 或引擎无效时返回空数组 → 只显示字母徽标。
 */
export function iconSourcesFor(engine, { allowIcons = true } = {}) {
  if (!allowIcons || !engine) return [];

  const custom = sanitizeIcon(engine.icon);
  if (custom) return [{ type: 'remote', url: custom }];

  const sources = [];
  const pageUrl = faviconPageUrl(engine.url);
  if (pageUrl) sources.push({ type: 'favicon', pageUrl });
  for (const url of faviconIcoCandidates(engine.url)) {
    sources.push({ type: 'remote', url });
  }
  return sources;
}

/**
 * 把任意来源的数据收敛成合法状态：
 * 丢弃坏引擎、去重 id、保证至少一个引擎启用、修正默认引擎。
 */
export function sanitizeState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== 'object') return fallback;

  const source = Array.isArray(raw.engines) && raw.engines.length ? raw.engines : fallback.engines;
  const engines = [];
  const seen = new Set();

  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const url = normalizeTemplate(item.url);
    if (!url) continue;

    const name = String(item.name ?? '').trim().slice(0, 24) || '未命名引擎';
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 64) : createId();
    while (seen.has(id)) id = createId();
    seen.add(id);

    engines.push({
      id,
      name,
      url,
      badge: sanitizeBadge(item.badge, name),
      color: normalizeColor(item.color),
      icon: sanitizeIcon(item.icon),
      enabled: item.enabled !== false,
    });
  }

  if (!engines.length) engines.push(...fallback.engines.map((engine) => ({ ...engine })));
  if (!engines.some((engine) => engine.enabled)) engines[0].enabled = true;

  const active = engines.find((engine) => engine.id === raw.activeEngineId && engine.enabled)
    ?? engines.find((engine) => engine.enabled)
    ?? engines[0];

  return {
    version: SCHEMA_VERSION,
    engines,
    activeEngineId: active.id,
    openInNewTab: raw.openInNewTab !== false,
    prefillSelection: raw.prefillSelection !== false,
    enableContextMenu: raw.enableContextMenu !== false,
    showEngineIcons: raw.showEngineIcons !== false,
  };
}

export function resolveActiveEngine(state) {
  if (!state || !Array.isArray(state.engines) || !state.engines.length) return null;
  const enabled = state.engines.filter((engine) => engine.enabled);
  return enabled.find((engine) => engine.id === state.activeEngineId) ?? enabled[0] ?? state.engines[0];
}

export function moveItem(list, from, to) {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  const index = Math.max(0, Math.min(next.length, to));
  next.splice(index, 0, item);
  return next;
}

export function serializeConfig(state) {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };
}

/** 解析导入的 JSON 文本，失败时抛出可直接展示给用户的中文错误 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }

  let candidate;
  if (Array.isArray(data)) {
    // 允许直接粘贴引擎数组
    candidate = { engines: data };
  } else if (data && typeof data === 'object' && data.state && typeof data.state === 'object') {
    candidate = data.state;
  } else {
    candidate = data;
  }

  if (!candidate || !Array.isArray(candidate.engines)) {
    throw new Error('JSON 中缺少 engines 列表');
  }
  return sanitizeState(candidate);
}

/* ------------------------------------------------------------------ *
 * chrome.storage 封装（仅在函数内部触碰 chrome，方便测试）
 * ------------------------------------------------------------------ */

function storageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
    throw new Error('当前环境不支持 chrome.storage.sync');
  }
  return chrome.storage.sync;
}

export async function loadState() {
  const area = storageArea();
  const stored = await area.get(STORAGE_KEY);
  const raw = stored ? stored[STORAGE_KEY] : undefined;
  const state = sanitizeState(raw);
  // 首次运行写入默认配置，避免每个入口都各自初始化
  if (!raw) await saveState(state);
  return state;
}

export async function saveState(state) {
  const clean = sanitizeState(state);
  await storageArea().set({ [STORAGE_KEY]: clean });
  return clean;
}

export async function patchState(mutator) {
  const current = await loadState();
  const draft = {
    ...current,
    engines: current.engines.map((engine) => ({ ...engine })),
  };
  const result = mutator(draft) ?? draft;
  return saveState(result);
}

export function onStateChanged(handler) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
    return () => {};
  }
  const listener = (changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    handler(sanitizeState(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
