// data.js — 数据适配层:加载 universe.public.json(蓝图 v1.2 四集合),
// 翻译成渲染层沿用的"客户星"形状,渲染代码(锁版)基本不动。
// 新模型字段(styles / stories / metAt / venue / partners)一并挂在星数据上,供档案页与名字牌使用。

// 字符串 → 稳定数字种子(星位与配色的确定性来源,与录入顺序无关)
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

const TYPE_LABEL = { wedding: '婚礼', anniversary: '纪念日', baby: '宝宝宴', proposal: '求婚', other: '' };

// 公开资料体量 → 星的大小依据(私密层不参与公开渲染,体量只按公开内容计)
function richnessOf(stories) {
  let r = 0;
  for (const st of stories) {
    r += 3;
    if (st.public.tagline) r += 1;
    if (st.public.concept) r += 3;
    r += (st.public.style || []).length + (st.public.elements || []).length;
  }
  return r;
}

export async function loadUniverse() {
  const res = await fetch('data/universe.public.json');
  const u = await res.json();

  const venueById = new Map(u.venues.map((v) => [v.id, v]));
  const partnerById = new Map(u.partners.map((p) => [p.id, p]));
  const storyById = new Map(u.stories.map((s) => [s.id, s]));

  const clients = u.systems.map((sys) => {
    const stories = sys.storyIds.map((id) => storyById.get(id)).filter(Boolean);
    const first = stories[0];
    // 每段故事解析出场地与伙伴实体,档案页直接可用
    const resolved = stories.map((st) => ({
      ...st,
      typeLabel: TYPE_LABEL[st.type] || st.type,
      venue: st.venueId ? venueById.get(st.venueId) : null,
      partners: (st.credits || []).map((c) => ({ ...partnerById.get(c.partnerId), role: c.role })).filter((p) => p.name),
    }));
    const styles = [...new Set(resolved.flatMap((st) => st.public.style || []))];
    const searchText = [
      sys.publicNames,
      ...resolved.flatMap((st) => [
        st.public.theme, st.public.tagline, st.public.concept,
        ...(st.public.style || []), ...(st.public.elements || []),
        st.venue && st.venue.name, st.venue && st.venue.city,
        ...st.partners.map((p) => p.name),
      ]),
    ].filter(Boolean).join(' ').toLowerCase();

    return {
      // ------ 渲染层沿用的旧字段 ------
      id: sys.id,
      name: sys.publicNames,
      year: first ? first.year : 2026,          // 星位年份 = 首段故事年份(蓝图映射规则)
      colorSeed: hashSeed(sys.id),
      colors: sys.colors,
      status: resolved.some((st) => st.status === 'done') ? 'done' : 'ing',
      industry: styles[0] || (first ? TYPE_LABEL[first.type] : ''),  // 悬停标签的小字:首个风格词
      tagline: first ? first.public.tagline : '',
      richness: richnessOf(stories),
      rings: Math.max(0, stories.length - 1),   // 光环数 = 故事数 − 1(回访的表达)
      // ------ 新模型字段 ------
      styles,
      metAt: sys.metAt || null,
      stories: resolved,
      searchText,
    };
  });

  return { clients, venues: u.venues, partners: u.partners };
}

// 相识计时:metAt → 「相识 1024 天 06 小时 42 分」;metAt 为空返回空串
export function sinceLabel(metAt) {
  if (!metAt) return '';
  const ms = Date.now() - Date.parse(metAt);
  if (!(ms > 0)) return '';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `相识 ${d} 天 ${pad(h)} 小时 ${pad(m)} 分,仍在继续`;
}

// 星址:由星的实际位置反推(蓝图:NW · 年环 · 方位角 · 仰角),终身不变
export function starAddress(planet) {
  const p = planet.group.position;
  let deg = (Math.atan2(p.z, p.x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const d = Math.floor(deg);
  const mi = Math.floor((deg - d) * 60);
  const elev = p.y >= 0 ? `+${p.y.toFixed(1)}` : p.y.toFixed(1);
  return `NW · ${planet.data.year} · ${d}°${String(mi).padStart(2, '0')}′ · ${elev}`;
}
