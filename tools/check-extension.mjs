/**
 * 打包前自检：清单引用、HTML 资源、JS 里用到的元素 id 是否都存在。
 * 用法：node tools/check-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const rel = (file) => path.relative(root, file).replaceAll('\\', '/');

/* 1. 清单 ------------------------------------------------------------ */

let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
} catch (error) {
  console.error(`✗ manifest.json 无法解析：${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) problems.push('manifest_version 应为 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) problems.push(`version 不是语义化版本：${manifest.version}`);
if ((manifest.name ?? '').length > 75) problems.push('name 超过 75 个字符');
if ((manifest.description ?? '').length > 132) problems.push('description 超过 132 个字符');
if (!manifest.action?.default_popup) problems.push('缺少 action.default_popup');

const manifestRefs = new Set([
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean));

for (const ref of manifestRefs) {
  if (!exists(ref)) problems.push(`清单引用的文件不存在：${ref}`);
}

notes.push(`清单：${manifest.name} v${manifest.version}`);
notes.push(`权限：${(manifest.permissions ?? []).join(', ') || '（无）'}`);
notes.push(`主机权限：${(manifest.host_permissions ?? []).join(', ') || '（无）'}`);

/* 2. HTML 引用与 id ------------------------------------------------ */

const pages = fs
  .readdirSync(path.join(root, 'src'))
  .filter((name) => name.endsWith('.html'));

for (const page of pages) {
  const html = read(`src/${page}`);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(https?:|data:|#)/.test(target)) continue;
    const resolved = path.posix.normalize(`src/${target}`);
    if (!exists(resolved)) problems.push(`${page} 引用了不存在的资源：${target}`);
  }

  const scriptMatch = html.match(/<script[^>]*src="([^"]+)"/);
  if (!scriptMatch) {
    notes.push(`${page}：无脚本（正常）`);
    continue;
  }

  const scriptFile = path.posix.normalize(`src/${scriptMatch[1]}`);
  if (!exists(scriptFile)) {
    problems.push(`${page} 的脚本不存在：${scriptMatch[1]}`);
    continue;
  }

  const js = read(scriptFile);
  const used = new Set();
  for (const match of js.matchAll(/getElementById\('([^']+)'\)/g)) used.add(match[1]);
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) used.add(match[1]);

  const missing = [...used].filter((id) => !ids.has(id));
  if (missing.length) problems.push(`${scriptFile} 引用了不存在的 id：${missing.join(', ')}`);

  notes.push(`${page} → ${scriptFile}：${used.size} 个 id 引用全部匹配`);
}

/* 3. 相对模块引用 ------------------------------------------------ */

const jsFiles = fs
  .readdirSync(path.join(root, 'src'))
  .filter((name) => name.endsWith('.js'));

for (const file of jsFiles) {
  const code = read(`src/${file}`);
  for (const match of code.matchAll(/from\s+'(\.\/[^']+)'/g)) {
    const target = path.posix.normalize(`src/${match[1]}`);
    if (!exists(target)) problems.push(`${file} 引用了不存在的模块：${match[1]}`);
  }
}

/* 4. 图标尺寸 ------------------------------------------------------ */

for (const [size, file] of Object.entries(manifest.icons ?? {})) {
  if (!exists(file)) continue;
  const buffer = fs.readFileSync(path.join(root, file));
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== Number(size) || height !== Number(size)) {
    problems.push(`${file} 尺寸为 ${width}x${height}，清单声明为 ${size}`);
  }
}

/* 4. 汇总 ---------------------------------------------------------- */

for (const note of notes) console.log(`· ${note}`);

if (problems.length) {
  console.error('\n发现问题：');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(`\n✓ 自检通过（${pages.length} 个页面，${manifestRefs.size} 个清单引用）`);
