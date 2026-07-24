// detail.js — 星球详情层:毛玻璃面板 + 三个页签,内容全部来自 clients.json
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

  function renderStory(client) {
    const items = client.story.map((s) => `
      <div class="tl-item">
        <div class="tl-year">${esc(s.year)}</div>
        <div class="tl-title">${esc(s.title)}</div>
        <div class="tl-text">${esc(s.text)}</div>
      </div>`).join('');
    panes.story.innerHTML = `<div class="timeline">${items}</div>`;
  }

  function renderArticle(client) {
    const paras = client.article.body.map((p) => `<p class="article-p">${esc(p)}</p>`).join('');
    panes.article.innerHTML = `<h2 class="article-title">${esc(client.article.title)}</h2>${paras}`;
  }

  function renderProposal(client) {
    panes.proposal.innerHTML = client.proposal.map((ph) => `
      <div class="phase-card">
        <div class="phase-head">
          <div class="phase-name">${esc(ph.phase)}</div>
          <div class="phase-duration">${esc(ph.duration)}</div>
        </div>
        <ul>${ph.deliverables.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      </div>`).join('');
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
      elMeta.innerHTML = `<span class="ind-tag">${esc(client.industry)}</span><span>${esc(client.tagline)}</span>`;
      renderStory(client);
      renderArticle(client);
      renderProposal(client);
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
