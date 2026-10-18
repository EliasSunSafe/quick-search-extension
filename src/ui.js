/**
 * 快搜 · 界面小部件
 *
 * 搜索引擎图标：优先用自定义图标，其次用浏览器官方图标接口（_favicon，
 * 取站点声明的正式图标并走本地缓存），再退回站点的 /favicon.ico；
 * 全部失败时保留彩色字母徽标，所以任何情况下都有东西可看。
 */

import { iconSourcesFor } from './common.js';

const FALLBACK_COLOR = '#64748b';

/**
 * 把图标来源解析成可用的 <img> src。
 * 官方图标走 chrome-extension://<id>/_favicon/，需要浏览器扩展环境；
 * 环境不满足（例如测试或普通网页）时返回空字符串，由调用方跳过。
 */
function resolveSource(source) {
  if (source.type === 'favicon') {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(source.pageUrl)}&size=32`);
    }
    return '';
  }
  return source.url;
}

/**
 * @param {{ name: string, url: string, badge: string, color: string, icon?: string }} engine
 * @param {{ allowIcons?: boolean, className?: string }} [options]
 */
export function createEngineIcon(engine, { allowIcons = true, className = '' } = {}) {
  const wrap = document.createElement('span');
  wrap.className = `engine-icon ${className}`.trim();
  wrap.style.setProperty('--badge-color', engine?.color || FALLBACK_COLOR);

  const badge = engine?.badge || '?';
  const letter = document.createElement('span');
  letter.className = 'engine-icon-letter';
  letter.textContent = badge;
  wrap.dataset.len = String([...badge].length);
  wrap.append(letter);

  const sources = iconSourcesFor(engine, { allowIcons });
  if (!sources.length) return wrap;

  const image = document.createElement('img');
  image.className = 'engine-icon-img';
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';

  let next = 0;
  const tryNext = () => {
    while (next < sources.length) {
      const url = resolveSource(sources[next]);
      next += 1;
      if (url) {
        image.src = url;
        return;
      }
    }
    image.remove();
  };

  image.addEventListener('load', () => wrap.classList.add('has-icon'));
  image.addEventListener('error', tryNext);

  wrap.append(image);
  tryNext();
  return wrap;
}
