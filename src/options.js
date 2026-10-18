import {
  createDefaultState,
  createId,
  loadState,
  moveItem,
  normalizeTemplate,
  onStateChanged,
  parseImport,
  resolveActiveEngine,
  sanitizeBadge,
  sanitizeIcon,
  saveState,
  serializeConfig,
} from './common.js';
import { createEngineIcon } from './ui.js';

const $ = (id) => document.getElementById(id);

const els = {
  list: $('engineList'),
  add: $('addBtn'),
  defaultSelect: $('defaultEngine'),
  openInNewTab: $('openInNewTab'),
  prefillSelection: $('prefillSelection'),
  enableContextMenu: $('enableContextMenu'),
  showEngineIcons: $('showEngineIcons'),
  exportBtns: [$('exportBtn'), $('exportBtn2')],
  importBtns: [$('importBtn'), $('importBtn2')],
  importFile: $('importFile'),
  reset: $('resetBtn'),
  dialog: $('engineDialog'),
  dialogTitle: $('dialogTitle'),
  form: $('engineForm'),
  fName: $('fName'),
  fUrl: $('fUrl'),
  fBadge: $('fBadge'),
  fColor: $('fColor'),
  fIcon: $('fIcon'),
  fEnabled: $('fEnabled'),
  iconPreview: $('iconPreview'),
  formError: $('formError'),
  cancel: $('cancelBtn'),
  toast: $('toast'),
};

let state = createDefaultState();
let editingId = null;
let dragId = null;
let toastTimer = 0;

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function toast(message, tone = 'info') {
  els.toast.textContent = message;
  els.toast.dataset.tone = tone;
  els.toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

function miniButton(action, text, label, disabled = false, tone = '') {
  const button = el('button', `btn-mini ${tone}`.trim(), text);
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  return button;
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function buildRow(engine, index) {
  const row = el('li', 'engine-row');
  row.draggable = true;
  row.dataset.id = engine.id;

  const handle = el('span', 'drag-handle', '⠿');
  handle.title = '拖动排序';
  handle.setAttribute('aria-hidden', 'true');

  const icon = createEngineIcon(engine, { allowIcons: state.showEngineIcons, className: 'size-lg' });

  const info = el('div', 'engine-info');
  const title = el('div', 'engine-title');
  title.append(el('span', 'engine-name', engine.name));
  if (engine.id === state.activeEngineId) title.append(el('span', 'tag', '默认'));
  if (!engine.enabled) title.append(el('span', 'tag tag-muted', '已停用'));
  info.append(title, el('code', 'engine-url', engine.url));

  const actions = el('div', 'engine-actions');
  actions.append(
    miniButton('up', '↑', `上移 ${engine.name}`, index === 0),
    miniButton('down', '↓', `下移 ${engine.name}`, index === state.engines.length - 1),
  );

  const switchLabel = el('label', 'switch');
  switchLabel.title = engine.enabled ? '已启用' : '已停用';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = engine.enabled;
  toggle.dataset.action = 'toggle';
  toggle.setAttribute('aria-label', `启用 ${engine.name}`);
  switchLabel.append(toggle, el('span', 'track'));

  actions.append(
    switchLabel,
    miniButton('edit', '编辑', `编辑 ${engine.name}`),
    miniButton('delete', '删除', `删除 ${engine.name}`, false, 'danger'),
  );

  row.append(handle, icon, info, actions);
  return row;
}

function renderEngines() {
  els.list.replaceChildren(...state.engines.map((engine, index) => buildRow(engine, index)));
}

function renderDefaultSelect() {
  const active = resolveActiveEngine(state);
  const options = state.engines
    .filter((engine) => engine.enabled)
    .map((engine) => {
      const option = document.createElement('option');
      option.value = engine.id;
      option.textContent = engine.name;
      return option;
    });
  els.defaultSelect.replaceChildren(...options);
  els.defaultSelect.value = active ? active.id : '';
  els.defaultSelect.disabled = options.length === 0;
}

function render() {
  renderEngines();
  renderDefaultSelect();
  els.openInNewTab.checked = state.openInNewTab;
  els.prefillSelection.checked = state.prefillSelection;
  els.enableContextMenu.checked = state.enableContextMenu;
  els.showEngineIcons.checked = state.showEngineIcons;
}

async function persist(message) {
  try {
    state = await saveState(state);
    render();
    if (message) toast(message);
    return true;
  } catch (error) {
    toast(`保存失败：${error.message}`, 'error');
    try {
      state = await loadState();
    } catch {
      // 读回也失败时保持内存中的状态
    }
    render();
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 引擎操作
 * ------------------------------------------------------------------ */

async function setEngineEnabled(id, enabled) {
  const engine = state.engines.find((item) => item.id === id);
  if (!engine) return;

  if (!enabled && state.engines.filter((item) => item.enabled).length <= 1) {
    render();
    toast('至少需要保留一个启用的搜索引擎', 'error');
    return;
  }

  engine.enabled = enabled;
  if (enabled) {
    const active = state.engines.find((item) => item.id === state.activeEngineId);
    if (!active || !active.enabled) state.activeEngineId = id;
  }

  await persist(enabled ? `已启用「${engine.name}」` : `已停用「${engine.name}」`);
}

async function removeEngine(id) {
  const engine = state.engines.find((item) => item.id === id);
  if (!engine) return;

  if (state.engines.length <= 1) {
    toast('至少需要保留一个搜索引擎', 'error');
    return;
  }
  if (!window.confirm(`确定删除「${engine.name}」吗？`)) return;

  state.engines = state.engines.filter((item) => item.id !== id);
  await persist(`已删除「${engine.name}」`);
}

async function moveEngine(id, delta) {
  const from = state.engines.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.engines.length) return;
  state.engines = moveItem(state.engines, from, to);
  await persist();
}

/* ------------------------------------------------------------------ *
 * 添加 / 编辑对话框
 * ------------------------------------------------------------------ */

function openDialog(engine = null) {
  editingId = engine ? engine.id : null;
  els.dialogTitle.textContent = engine ? `编辑「${engine.name}」` : '添加搜索引擎';
  els.fName.value = engine ? engine.name : '';
  els.fUrl.value = engine ? engine.url : '';
  els.fBadge.value = engine ? engine.badge : '';
  els.fColor.value = engine ? engine.color : '#64748b';
  els.fIcon.value = engine ? engine.icon : '';
  els.fEnabled.checked = engine ? engine.enabled : true;
  els.formError.textContent = '';
  updateIconPreview();
  els.dialog.showModal();
  window.setTimeout(() => els.fName.focus(), 30);
}

/** 对话框里的图标预览：名称/地址/颜色/图标任一变化都跟着更新 */
function updateIconPreview() {
  const name = els.fName.value.trim() || '引擎';
  const url = normalizeTemplate(els.fUrl.value) || els.fUrl.value.trim();
  els.iconPreview.replaceChildren(createEngineIcon({
    name,
    url,
    badge: sanitizeBadge(els.fBadge.value, name),
    color: els.fColor.value,
    icon: sanitizeIcon(els.fIcon.value),
  }, { allowIcons: state.showEngineIcons }));
}

function closeDialog() {
  editingId = null;
  if (els.dialog.open) els.dialog.close();
}

function showFormError(message) {
  els.formError.textContent = message;
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = els.fName.value.trim();
  if (!name) {
    showFormError('请填写引擎名称');
    els.fName.focus();
    return;
  }

  const url = normalizeTemplate(els.fUrl.value);
  if (!url) {
    showFormError('搜索地址需要以 http:// 或 https:// 开头，并且包含 %s 占位符');
    els.fUrl.focus();
    return;
  }

  const badge = sanitizeBadge(els.fBadge.value, name);
  const color = els.fColor.value;
  const icon = sanitizeIcon(els.fIcon.value);
  const enabled = els.fEnabled.checked;
  const wasEditing = Boolean(editingId);

  if (wasEditing) {
    const target = state.engines.find((item) => item.id === editingId);
    if (target) Object.assign(target, { name, url, badge, color, icon, enabled });
  } else {
    state.engines.push({ id: createId(), name, url, badge, color, icon, enabled });
  }

  const message = wasEditing ? `已保存「${name}」` : `已添加「${name}」`;
  editingId = null;
  els.dialog.close();
  void persist(message);
});

els.cancel.addEventListener('click', closeDialog);

els.dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDialog();
});

for (const input of [els.fName, els.fUrl, els.fBadge, els.fColor, els.fIcon]) {
  input.addEventListener('input', updateIconPreview);
}

/* ------------------------------------------------------------------ *
 * 列表交互（点击 / 开关 / 拖拽排序）
 * ------------------------------------------------------------------ */

els.list.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  if (action === 'toggle') return;

  const row = target.closest('.engine-row');
  if (!row) return;
  const id = row.dataset.id;

  if (action === 'edit') {
    const engine = state.engines.find((item) => item.id === id);
    if (engine) openDialog(engine);
  } else if (action === 'delete') {
    void removeEngine(id);
  } else if (action === 'up') {
    void moveEngine(id, -1);
  } else if (action === 'down') {
    void moveEngine(id, 1);
  }
});

els.list.addEventListener('change', (event) => {
  const input = event.target.closest('[data-action="toggle"]');
  if (!input) return;
  const row = input.closest('.engine-row');
  if (!row) return;
  void setEngineEnabled(row.dataset.id, input.checked);
});

function clearDropIndicators() {
  for (const row of els.list.querySelectorAll('.engine-row')) {
    row.classList.remove('drop-before', 'drop-after');
  }
}

els.list.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.engine-row');
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
  }
});

els.list.addEventListener('dragend', () => {
  dragId = null;
  clearDropIndicators();
  for (const row of els.list.querySelectorAll('.is-dragging')) row.classList.remove('is-dragging');
});

els.list.addEventListener('dragover', (event) => {
  if (!dragId) return;
  event.preventDefault();
  clearDropIndicators();

  const row = event.target.closest('.engine-row');
  if (!row || row.dataset.id === dragId) return;

  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  row.classList.add(after ? 'drop-after' : 'drop-before');
});

els.list.addEventListener('drop', (event) => {
  if (!dragId) return;
  event.preventDefault();

  const row = event.target.closest('.engine-row');
  const after = Boolean(row && row.classList.contains('drop-after'));
  clearDropIndicators();

  if (!row || row.dataset.id === dragId) {
    dragId = null;
    return;
  }

  const from = state.engines.findIndex((item) => item.id === dragId);
  const targetIndex = state.engines.findIndex((item) => item.id === row.dataset.id);
  dragId = null;

  if (from < 0 || targetIndex < 0) return;

  let insertAt = targetIndex > from ? targetIndex - 1 : targetIndex;
  if (after) insertAt += 1;

  state.engines = moveItem(state.engines, from, insertAt);
  void persist();
});

/* ------------------------------------------------------------------ *
 * 通用设置
 * ------------------------------------------------------------------ */

els.defaultSelect.addEventListener('change', () => {
  state.activeEngineId = els.defaultSelect.value;
  void persist();
});

els.openInNewTab.addEventListener('change', () => {
  state.openInNewTab = els.openInNewTab.checked;
  void persist();
});

els.prefillSelection.addEventListener('change', () => {
  state.prefillSelection = els.prefillSelection.checked;
  void persist();
});

els.enableContextMenu.addEventListener('change', () => {
  state.enableContextMenu = els.enableContextMenu.checked;
  void persist();
});

els.showEngineIcons.addEventListener('change', () => {
  state.showEngineIcons = els.showEngineIcons.checked;
  void persist();
});

els.add.addEventListener('click', () => openDialog());

/* ------------------------------------------------------------------ *
 * 导入 / 导出 / 恢复默认
 * ------------------------------------------------------------------ */

function exportConfig() {
  const payload = serializeConfig(state);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `quick-search-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('已导出配置文件');
}

for (const button of els.exportBtns) button.addEventListener('click', exportConfig);
for (const button of els.importBtns) button.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', () => {
  const file = els.importFile.files && els.importFile.files[0];
  els.importFile.value = '';
  if (!file) return;

  void file.text().then((text) => {
    let imported;
    try {
      imported = parseImport(text);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }

    const ok = window.confirm(`将导入 ${imported.engines.length} 个搜索引擎并覆盖当前配置，继续吗？`);
    if (!ok) return;

    state = imported;
    void persist('导入成功');
  });
});

els.reset.addEventListener('click', () => {
  if (!window.confirm('恢复默认配置？自定义的搜索引擎和设置都会被覆盖。')) return;
  state = createDefaultState();
  void persist('已恢复默认设置');
});

/* ------------------------------------------------------------------ *
 * 与其它页面同步
 * ------------------------------------------------------------------ */

onStateChanged((next) => {
  if (els.dialog.open) return;
  try {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
  } catch {
    // 比较失败时直接采用新值
  }
  state = next;
  render();
});

async function init() {
  state = await loadState();
  render();
}

void init().catch((error) => toast(`加载设置失败：${error.message}`, 'error'));
