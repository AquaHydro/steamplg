// 客户端（steamplg.js）和 Cloudflare Worker（worker.js）共用
const STEAM = 61; // ITAD 里 Steam 的 shop id

// history: Steam 的价格变动记录。最新一条 = 当前价，其余 = 以前的价
export function classify(history) {
  const h = [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const cur = h[0]?.deal;
  if (!cur || cur.price.amount === 0) return null; // 没数据 / 免费游戏
  // 只比同币种的打折记录：ITAD 偶有原价抓错的脏记录（如国区星露谷 ¥14.99、cut 0）
  // ponytail: 原价永久下调到低于以往折扣价时会漏判，真遇到再处理
  const prev = h.slice(1).filter((e) => e.deal.cut > 0 && e.deal.price.currency === cur.price.currency);
  if (!prev.length) return cur.cut > 0 ? { text: '新史低', color: '#c00' } : null;
  const prevMin = Math.min(...prev.map((e) => e.deal.price.amount));
  if (cur.cut === 0) return { text: `未打折 · 史低 ${prevMin}`, color: '#666' };
  if (cur.price.amount < prevMin) return { text: '新史低', color: '#c00' };
  if (cur.price.amount === prevMin) return { text: '平史低', color: '#e60' };
  return { text: `非史低 · 史低 ${prevMin}`, color: '#666' };
}

export async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
  return r.json();
}

export async function fromItad(appid, country, key) {
  const itad = (path) => getJson(`https://api.isthereanydeal.com${path}&key=${key}`);
  const { found, game } = await itad(`/games/lookup/v1?appid=${appid}`);
  if (!found) return null;
  return classify(await itad(`/games/history/v2?id=${game.id}&country=${country}&shops=${STEAM}&since=2000-01-01T00:00:00Z`));
}
