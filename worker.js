// Cloudflare Worker：持有 ITAD Key，给客户端提供 GET /lowest?appid=730&country=CN
// Secret：ITAD_KEY（必填）；TOKEN（可选，设了就只接受 Authorization: Bearer <TOKEN>，自建私用时用）
// 官方实例不设 TOKEN：客户端内置了地址，打包进程序的口令谁都能拆出来，防滥用靠下面的限流和缓存
import { fromItad } from './itad.js';

const CACHE_S = 6 * 60 * 60; // 价格史低一天变不了几次，6 小时够新

export default {
  async fetch(req, env, ctx) {
    if (!env.ITAD_KEY) return new Response('未配置 ITAD_KEY', { status: 500 });
    if (env.TOKEN && req.headers.get('authorization') !== `Bearer ${env.TOKEN}`) return new Response(null, { status: 403 });
    const u = new URL(req.url);
    const appid = u.searchParams.get('appid');
    const country = u.searchParams.get('country') ?? 'CN';
    if (u.pathname !== '/lowest' || !/^\d{1,10}$/.test(appid) || !/^[A-Z]{2}$/.test(country)) return new Response(null, { status: 400 });
    if (env.LIMITER && !(await env.LIMITER.limit({ key: req.headers.get('cf-connecting-ip') ?? '' })).success) return new Response(null, { status: 429 });

    // Cache API 在 workers.dev 域名上不生效，只在自定义域名上生效。判定逻辑改了就把 v2 往上加，让旧结果失效
    const key = new Request(`https://cache.steamplg/v3/lowest?appid=${appid}&country=${country}`);
    const hit = await caches.default.match(key);
    if (hit) return hit;
    try {
      const res = Response.json(await fromItad(appid, country, env.ITAD_KEY), { headers: { 'cache-control': `max-age=${CACHE_S}` } });
      ctx.waitUntil(caches.default.put(key, res.clone()));
      return res;
    } catch (e) {
      return new Response(e.message, { status: 502 });
    }
  },
};
