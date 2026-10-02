// Cloudflare Worker：持有 ITAD Key，给客户端提供 GET /lowest?appid=730&country=CN
// Secret：ITAD_KEY、TOKEN（客户端用 Authorization: Bearer <TOKEN> 访问）
import { fromItad } from './itad.js';

export default {
  async fetch(req, env) {
    if (!env.ITAD_KEY || !env.TOKEN) return new Response('未配置 ITAD_KEY / TOKEN', { status: 500 });
    if (req.headers.get('authorization') !== `Bearer ${env.TOKEN}`) return new Response(null, { status: 403 });
    const u = new URL(req.url);
    const appid = u.searchParams.get('appid');
    const country = u.searchParams.get('country') ?? 'CN';
    if (u.pathname !== '/lowest' || !/^\d{1,10}$/.test(appid) || !/^[A-Z]{2}$/.test(country)) return new Response(null, { status: 400 });
    // ponytail: Worker 侧不缓存，客户端已缓存 1 小时；多人共用、额度吃紧再加 Cache API / KV
    try {
      return Response.json(await fromItad(appid, country, env.ITAD_KEY));
    } catch (e) {
      return new Response(e.message, { status: 502 });
    }
  },
};
