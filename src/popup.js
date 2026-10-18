import { buildSearchUrl, loadState, resolveActiveEngine, saveState } from './common.js';
import { createEngineIcon } from './ui.js';

const els = {
  form: document.getElementById('searchForm'),
  input: document.getElementById('query'),
  engines: document.getElementById('engines'),
  current: document.getElementById('currentEngine'),
  newTab: document.getElementById('newTab'),
  status: document.getElementById('status'),
  options: document.getElementById('openOptions'),
};

/** @type {ReturnType<typeof import('./common.js').createDefaultState> | null} */
let state = null;
let statusTimer = 0;

function showStatus(message, tone = 'info') {
  els.status.textContent = message;
  els.status.classList.toggle('is-error', tone === 'error');
  els.status.classList.add('is-visible');
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => els.status.classList.remove('is-visible'), 2400);
}

function enabledEngines() {
  return state ? state.engines.filter((engine) => engine.enabled) : [];
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function render() {
  const active = resolveActiveEngine(state);
  els.current.textContent = active ? active.name : '无可用引擎';
  els.current.title = active ? `${active.name} · ${active.url}` : '没有启用的搜索引擎';

  const chips = enabledEngines().map((engine) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.id = engine.id;
    chip.title = `用 ${engine.name} 搜索`;

    const isActive = Boolean(active) && active.id === engine.id;
    chip.classList.toggle('is-active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));

    const badge = createEngineIcon(engine, { allowIcons: state.showEngineIcons });

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = engine.name;

    chip.append(badge, name);

    return chip;
  });

  els.engines.replaceChildren(...chips);
}

/* ------------------------------------------------------------------ *
 * 搜索与切换
 * ------------------------------------------------------------------ */

async function runSearch(engine, rawQuery) {
  if (!engine) {
    showStatus('没有可用的搜索引擎，请先在设置中启用', 'error');
    return;
  }

  const query = String(rawQuery ?? '').trim();
  if (!query) {
    els.form.classList.add('is-shaking');
    window.setTimeout(() => els.form.classList.remove('is-shaking'), 420);
    els.input.focus();
    return;
  }

  let url;
  try {
    url = buildSearchUrl(engine, query);
  } catch (error) {
    showStatus(error.message, 'error');
    return;
  }

  const inNewTab = state.openInNewTab;

  try {
    if (inNewTab) {
      await chrome.tabs.create({ url });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id != null) await chrome.tabs.update(tab.id, { url });
      else await chrome.tabs.create({ url });
    }
    window.close();
  } catch (error) {
    showStatus(`打开失败：${error.message}`, 'error');
  }
}

async function selectEngine(id) {
  const engine = state.engines.find((item) => item.id === id);
  if (!engine) return;

  if (state.activeEngineId !== id) {
    state.activeEngineId = id;
    try {
      state = await saveState(state);
    } catch {
      // 持久化失败不影响本次搜索
    }
    render();
  }

  const query = els.input.value.trim();
  if (query) {
    await runSearch(engine, query);
    return;
  }

  showStatus(`已切换到「${engine.name}」`);
  els.input.focus();
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state) return;
  void runSearch(resolveActiveEngine(state), els.input.value);
});

els.engines.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip || !state) return;
  void selectEngine(chip.dataset.id);
});

els.newTab.addEventListener('change', () => {
  if (!state) return;
  state.openInNewTab = els.newTab.checked;
  void saveState(state).catch(() => {});
  showStatus(state.openInNewTab ? '结果将在新标签页打开' : '结果将在当前标签页打开');
});

els.options.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

/**
 * 页面上有选中文字时自动填入搜索框（需要 activeTab，仅本次点击有效）。
 * edge:// 等特殊页面注入失败属于正常情况，直接忽略。
 */
async function prefillSelection() {
  if (!state.prefillSelection || els.input.value) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim(),
    });

    const text = typeof injection?.result === 'string' ? injection.result : '';
    if (!text || els.input.value) return;

    els.input.value = text.slice(0, 200);
    els.input.select();
    showStatus('已填入页面中选中的文本');
  } catch {
    // 无法注入脚本的页面（edge://、扩展商店等）静默跳过
  }
}

async function init() {
  state = await loadState();
  els.newTab.checked = state.openInNewTab;
  render();
  await prefillSelection();
  els.input.focus();
}

void init().catch((error) => {
  showStatus(`初始化失败：${error.message}`, 'error');
});
