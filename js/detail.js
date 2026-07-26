// detail.js — 星球详情层(档案):毛玻璃面板 + 三个页签,内容来自数据层 v1.2 公开层
// 页签:故事(每段故事一张卡:主题/婚期/场地/署名/概念) · 成篇(归档中占位) · 方案(私密占位)
import { sinceLabel } from './data.js';

export function createDetailLayer() {
  const layer = document.getElementById('detail-layer');
  const panel = document.getElementById('detail-panel');
  const btnBack = document.getElementById('detail-back');
  const elName = document.getElementById('detail-name');
  const elMeta = document.getElementById('detail-meta');
  const panes = {
    story: document.getElementById('tab-story'),
    article: document.getElementById('tab-article'),
    proposal: document.getElementById('tab-proposal'),
  };
  const tabBtns = Array.from(layer.querySelectorAll('.tab-btn'));

  let currentClient = null;
  let closeCallback = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const ROLE_LABEL = { photographer: '摄影', videographer: '摄像', host: '主持', musician: '乐手' };

  function renderStories(client) {
    const items = client.stories.map((st) => {
      const when = st.date ? st.date.replaceAll('-', '.') : `${st.year}${st.season ? ' ' + st.season : ''}`;
      const where = st.venue ? `${st.venue.name} · ${st.venue.city}` : '';
      const credits = st.partners.map((p) => `${p.name}(${p.roleLabel || ROLE_LABEL[p.role] || p.role})`).join(' / ');
      const tags = [...(st.public.style || []), ...(st.public.elements || [])];
      const arctic = st.arctic ? `<div class="tl-arctic">已存入北极 · ${esc(st.arctic.year)}</div>` : '';
      return `
      <div class="tl-item">
        <div class="tl-year">${esc(st.typeLabel)} · ${esc(when)}${where ? ' · ' + esc(where) : ''}</div>
        <div class="tl-title">${esc(st.public.theme || '')}</div>
        <div class="tl-text">${esc(st.public.tagline || '')}</div>
        ${st.public.concept ? `<div class="tl-text tl-concept">${esc(st.public.concept)}</div>` : ''}
        ${tags.length ? `<div class="tl-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        ${credits ? `<div class="tl-credits">同行 · ${esc(credits)}</div>` : ''}
        ${arctic}
      </div>`;
    }).join('');
    panes.story.innerHTML = `<div class="timeline">${items}</div>`;
  }

  function renderArticle() {
    panes.article.innerHTML = '<p class="article-p pane-placeholder">最终成篇正在归档中,归档后在此处开卷。</p>';
  }

  function renderProposal() {
    panes.proposal.innerHTML = '<p class="article-p pane-placeholder">方案属于两个人的私密内容,凭专属入口可见。</p>';
  }

  function switchTab(name) {
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    Object.entries(panes).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }

  tabBtns.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  btnBack.addEventListener('click', () => api.close());

  const api = {
    open(client) {
      currentClient = client;
      elName.textContent = client.name;
      const since = sinceLabel(client.metAt);
      elMeta.innerHTML = [
        client.styles && client.styles.length ? `<span class="ind-tag">${esc(client.styles.join(' · '))}</span>` : '',
        client.tagline ? `<span>${esc(client.tagline)}</span>` : '',
        client.address ? `<span class="detail-coord">${esc(client.address)}</span>` : '',
        since ? `<span class="detail-since">${esc(since)}</span>` : '',
      ].join('');
      renderStories(client);
      renderArticle();
      renderProposal();
      switchTab('story');
      layer.classList.remove('hidden');
      // 下一帧再加 open 类,触发 CSS 过渡
      requestAnimationFrame(() => layer.classList.add('open'));
    },

    close() {
      if (layer.classList.contains('hidden')) return;
      layer.classList.remove('open');
      setTimeout(() => layer.classList.add('hidden'), 420);
      currentClient = null;
      if (closeCallback) closeCallback();
    },

    isOpen() { return !layer.classList.contains('hidden'); },
    current() { return currentClient; },
    onClose(cb) { closeCallback = cb; },
  };

  return api;
}
