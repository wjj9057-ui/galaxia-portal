// build-universe.mjs — 数据构建脚本(蓝图第四节)
// 职责:读取 data/source/ 四集合 → 校验引用完整性 → 自动生成反向引用(storyIds)
//      → 公私分层输出:data/universe.public.json(公开层,前端加载)
//                      data/universe.private.json(私密层,仅本地/后台用,勿部署到公开站点)
// 用法:node scripts/build-universe.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(root, 'data/source', f), 'utf8'));

const systems = read('systems.json');
const stories = read('stories.json');
const venues = read('venues.json');
const partners = read('partners.json');

// ---------- 校验 ----------
const errors = [];
const dupCheck = (list, label) => {
  const seen = new Set();
  for (const it of list) {
    if (!it.id) errors.push(`${label} 有条目缺 id`);
    else if (seen.has(it.id)) errors.push(`${label} id 重复:${it.id}`);
    seen.add(it.id);
  }
  return seen;
};
const sysIds = dupCheck(systems, 'systems');
const venIds = dupCheck(venues, 'venues');
const parIds = dupCheck(partners, 'partners');
dupCheck(stories, 'stories');

for (const st of stories) {
  if (!sysIds.has(st.systemId)) errors.push(`故事 ${st.id} 指向不存在的新人 ${st.systemId}`);
  if (st.venueId && !venIds.has(st.venueId)) errors.push(`故事 ${st.id} 指向不存在的场地 ${st.venueId}`);
  for (const c of st.credits || []) {
    if (!parIds.has(c.partnerId)) errors.push(`故事 ${st.id} 署名指向不存在的伙伴 ${c.partnerId}`);
  }
  if (!st.year) errors.push(`故事 ${st.id} 缺年份`);
}
for (const sys of systems) {
  if (sys.metAt && Number.isNaN(Date.parse(sys.metAt))) errors.push(`新人 ${sys.id} 的 metAt 不是合法时间:${sys.metAt}`);
}
if (errors.length) {
  console.error('校验失败:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}

// ---------- 反向引用(录入时只在故事上填 systemId/venueId/credits) ----------
const byIdAsc = (a, b) => (a.year - b.year) || a.id.localeCompare(b.id);
const sortedStories = [...stories].sort(byIdAsc);
const refMap = (key) => {
  const m = new Map();
  for (const st of sortedStories) {
    const ks = key(st);
    for (const k of ks) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(st.id);
    }
  }
  return m;
};
const sysRefs = refMap((st) => [st.systemId]);
const venRefs = refMap((st) => (st.venueId ? [st.venueId] : []));
const parRefs = refMap((st) => (st.credits || []).map((c) => c.partnerId));

// ---------- 公私分层输出 ----------
const pub = {
  builtAt: null, // 部署时间戳由部署流程填,构建保持确定性输出
  systems: systems.map((s) => ({
    id: s.id,
    publicNames: s.publicNames,
    colors: s.colors,
    metAt: s.metAt || null, // 相识计时全量公开(卷定稿 2026-07-26)
    storyIds: sysRefs.get(s.id) || [],
  })),
  stories: stories.map((st) => ({
    id: st.id,
    systemId: st.systemId,
    type: st.type,
    year: st.year,
    season: st.season || '',
    venueId: st.venueId || null,
    credits: st.credits || [],
    status: st.status || 'ing',
    arctic: st.arctic || null,
    public: st.public || {},
  })),
  venues: venues.map((v) => ({ ...v, storyIds: venRefs.get(v.id) || [] })),
  partners: partners.map((p) => ({ ...p, storyIds: parRefs.get(p.id) || [] })),
};

// 私密层单独成文件:internalNames 与 story.private 绝不进入公开输出
const priv = {
  systems: systems.map((s) => ({ id: s.id, internalNames: s.internalNames || '' })),
  stories: stories.map((st) => ({ id: st.id, private: st.private || {} })),
};

const stringify = (o) => JSON.stringify(o, null, 2) + '\n';
writeFileSync(join(root, 'data/universe.public.json'), stringify(pub));
writeFileSync(join(root, 'data/universe.private.json'), stringify(priv));

console.log(`构建完成:${systems.length} 颗星 / ${stories.length} 段故事 / ${venues.length} 朵星云 / ${partners.length} 颗彗星`);
console.log('输出:data/universe.public.json(公开层)、data/universe.private.json(私密层,勿部署)');
