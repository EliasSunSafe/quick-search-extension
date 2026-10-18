import {
  buildSearchUrl,
  loadState,
  onStateChanged,
  resolveActiveEngine,
} from './common.js';

const MENU_ID = 'quick-search-root';
const ITEM_PREFIX = 'quick-search:';

/** 兼容老版本：contextMenus 的回调式 API 包成 Promise */
function removeAllMenus() {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function createMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

/** 按当前配置重建右键菜单：根项用默认引擎，子项列出全部启用引擎 */
async function rebuildContextMenus() {
  await removeAllMenus();

  const state = await loadState();
  if (!state.enableContextMenu) return;

  const enabled = state.engines.filter((engine) => engine.enabled);
  if (!enabled.length) return;

  const active = resolveActiveEngine(state);
  await createMenu({
    id: MENU_ID,
    title: `用「${active ? active.name : '搜索引擎'}」搜索“%s”`,
    contexts: ['selection'],
  });

  for (const engine of enabled) {
    await createMenu({
      id: ITEM_PREFIX + engine.id,
      parentId: MENU_ID,
      title: engine.name,
      contexts: ['selection'],
    });
  }
}

async function handleMenuClick(info, tab) {
  const text = String(info.selectionText ?? '').trim();
  if (!text) return;

  const state = await loadState();
  const menuItemId = String(info.menuItemId);

  let engine = null;
  if (menuItemId === MENU_ID) {
    engine = resolveActiveEngine(state);
  } else if (menuItemId.startsWith(ITEM_PREFIX)) {
    const engineId = menuItemId.slice(ITEM_PREFIX.length);
    engine = state.engines.find((item) => item.id === engineId) ?? null;
  }
  if (!engine) return;

  // 选中文本可能非常长，截断避免超出地址栏长度限制
  const url = buildSearchUrl(engine, text.slice(0, 1000));

  try {
    if (!state.openInNewTab && tab && tab.id != null) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      const createOptions = { url };
      if (tab && tab.id != null) createOptions.openerTabId = tab.id;
      await chrome.tabs.create(createOptions);
    }
  } catch {
    await chrome.tabs.create({ url });
  }
}

/**
 * 串行化菜单重建：连续修改配置时避免并发 removeAll/create 造成 id 冲突。
 */
let rebuildChain = Promise.resolve();

function scheduleRebuild() {
  rebuildChain = rebuildChain
    .then(() => rebuildContextMenus())
    .catch((error) => console.warn('[快搜] 重建右键菜单失败：', error));
  return rebuildChain;
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    try {
      await loadState();
      await scheduleRebuild();
      if (details.reason === 'install') {
        await chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html') });
      }
    } catch (error) {
      console.warn('[快搜] 安装初始化失败：', error);
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleRebuild();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleMenuClick(info, tab).catch((error) => console.warn('[快搜] 右键搜索失败：', error));
});

onStateChanged(() => {
  void scheduleRebuild();
});
