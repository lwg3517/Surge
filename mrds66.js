// 每日大赛 mrds66.com Spider — JavaScript 转换版（Node.js 18+）
// API 保留 FongMi / CatVod Spider 方法名与返回结构；网络请求使用 fetch。
// AES-128-CBC/ECB 仅依赖 Node 内置 crypto。

'use strict';

const crypto = require('node:crypto');

const HOSTS = ['https://www.mrds66.com', 'https://mrds.com'];
const HOST = HOSTS[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Referer: HOST + '/',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const CHALLENGE_MARKS = ['challenge-platform', 'cf-chl-', 'cf-browser-verification', '_cf_chl_opt', 'just a moment'];
const STUB_MARKS = ['window.location.replace', 'location.href='];
const STUB_MAX_LEN = 3000;
const HOME_TTL = 60;
const CATEGORIES = [
  ['mrds', '每日大赛'], ['ztds', '主题大赛'], ['rstt', '热搜吃瓜'],
  ['xazd', '校园学生'], ['blyp', '必撸大赛'], ['fctg', '反差泄密'],
  ['mhds', '网红黑料'], ['lqdp', '猎奇重口'], ['jdsj', 'AV看片'],
  ['mxwh', '明星大赛'], ['smdh', '动漫之家'], ['dypd', '影视国漫'],
  ['mtds', 'cos写真'], ['ysds', '声控ASMR'], ['czds', '寸止挑战'],
  ['hjds', '混剪PMV'], ['tgds', '原创投稿'], ['omjp', '欧美精品'],
  ['qwcs', '全网参赛'], ['aijc', 'AI剧场'],
];
const PAGE_SIZE = 30;
const FETCH_TIMEOUT = 15;
const FETCH_RETRIES = 3;
const IMG_KEYS = [
  [Buffer.from('f5d965df75336270'), Buffer.from('97b60394abc2fbe1')],
  [Buffer.from('75336270f5d965df'), Buffer.from('abc2fbe197b60394')],
];
const IMG_MAGIC = [
  [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
  [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
  [Buffer.from('GIF8'), 'image/gif'],
  [Buffer.from('RIFF'), 'image/webp'],
];
const INLINE_PIC = false;
const PIC_TIMEOUT = 15;
const PIC_CACHE_MAX = 64;

function htmlUnescape(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'" };
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const n = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '\ufffd';
      try { return String.fromCodePoint(n); } catch { return '\ufffd'; }
    }
    return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase()) ? named[entity.toLowerCase()] : whole;
  });
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function imgMime(data) {
  if (!data?.length) return '';
  for (const [magic, mime] of IMG_MAGIC) if (data.subarray(0, magic.length).equals(magic)) return mime;
  return '';
}
function aesDecryptBlock(data, key, iv = null) {
  if (!data?.length || data.length % 16) return Buffer.alloc(0);
  try {
    const decipher = crypto.createDecipheriv(iv ? 'aes-128-cbc' : 'aes-128-ecb', key, iv);
    decipher.setAutoPadding(false);
    let out = Buffer.concat([decipher.update(data), decipher.final()]);
    const pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && out.subarray(out.length - pad).every(x => x === pad)) out = out.subarray(0, out.length - pad);
    return out;
  } catch { return Buffer.alloc(0); }
}
function aesDecryptImg(data) {
  for (const [key, iv] of IMG_KEYS) { const out = aesDecryptBlock(data, key, iv); if (imgMime(out)) return out; }
  for (const [key] of IMG_KEYS) { const out = aesDecryptBlock(data, key); if (imgMime(out)) return out; }
  return Buffer.alloc(0);
}
function b64Text(text) {
  let s = String(text ?? '').trim().replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - s.length % 4) % 4);
  try { return Buffer.from(s, 'base64').toString('utf8').trim(); } catch { return ''; }
}
function restoreUrl(value) {
  value = String(value ?? '').trim();
  if (!value) return '';
  const candidates = [value];
  try { const plain = decodeURIComponent(value); if (plain !== value) candidates.push(plain); } catch {}
  for (const item of [...candidates]) for (const fixed of [item.replace(/ /g, '+'), item]) {
    const decoded = b64Text(fixed); if (decoded) candidates.push(decoded);
  }
  return candidates.find(x => x.startsWith('http://') || x.startsWith('https://')) || '';
}
function encodeQuery(value) { return encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

class Spider {
  constructor() {
    this.hosts = [...HOSTS]; this.host = HOST; this.h265 = false; this.inline_pic = INLINE_PIC;
    this.proxies = {}; this.headers = { ...HEADERS }; this._home_cache = [0, '']; this._pic_cache = new Map();
  }
  init(extend = '') {
    const ext = Spider._parse_ext(extend);
    const host = String(ext.host || ext.url || '').trim().replace(/\/+$/, '');
    this.hosts = /^https?:\/\//i.test(host) ? [host] : [...HOSTS];
    this.host = this.hosts[0]; this.h265 = Boolean(ext.h265); this.inline_pic = Spider._pic_mode_inline(ext);
    this.proxies = Spider._ext_proxies(ext); this.headers = { ...HEADERS };
    this._home_cache = [0, '']; this._pic_cache = new Map();
    const cookie = String(ext.cookie || ext.Cookie || '').trim(); if (cookie) this.headers.Cookie = cookie;
  }
  getName() { return '每日大赛'; }
  destroy() { this.headers = { ...HEADERS }; this.proxies = {}; this._home_cache = [0, '']; this._pic_cache = new Map(); }

  async localProxy(param) {
    const url = Spider._proxy_param_url(param);
    if (!url) return [404, 'text/plain', Buffer.alloc(0)];
    const raw = await this._pic_bytes(url), mime = imgMime(raw);
    return mime ? [200, mime, raw] : [404, 'text/plain', Buffer.alloc(0)];
  }
  async _pic(url) { return (await this._pics([url]))[0]; }
  async _pics(urls) {
    const out = Array(urls.length).fill(''), pending = [];
    for (let i = 0; i < urls.length; i++) {
      const url = String(urls[i] || '').trim(); if (!url) continue;
      if (!url.startsWith('http') || this._is_own_host(url)) { out[i] = url; continue; }
      if (!this.inline_pic) { const proxyUrl = this._proxy_pic_url(url); if (proxyUrl) { out[i] = proxyUrl; continue; } this._log('proxy base unavailable -> inline fallback'); }
      pending.push([i, url]);
    }
    const fetched = await Promise.all(pending.map(async ([i, url]) => [i, url, await this._inline_one(url)]));
    for (const [i, , dataUri] of fetched) if (dataUri) out[i] = dataUri;
    return out;
  }
  async _inline_one(url) {
    const raw = await this._pic_bytes(url), mime = imgMime(raw);
    return mime ? `data:${mime};base64,${raw.toString('base64')}` : '';
  }
  async _pic_bytes(url) {
    if (this._pic_cache.has(url)) return this._pic_cache.get(url);
    let raw;
    try {
      const headers = { ...this.headers, Referer: this.host + '/' };
      const response = await this._request(url, headers, PIC_TIMEOUT);
      raw = Buffer.from(await response.arrayBuffer());
    } catch (e) { this._log(`pic fetch fail: ${url} -> ${e}`); return Buffer.alloc(0); }
    if (!imgMime(raw)) raw = aesDecryptImg(raw);
    if (!raw.length) return raw;
    if (this._pic_cache.size >= PIC_CACHE_MAX) this._pic_cache.delete(this._pic_cache.keys().next().value);
    this._pic_cache.set(url, raw); return raw;
  }
  async _with_pics(items) {
    const pics = await this._pics(items.map(it => it.vod_pic || ''));
    items.forEach((it, i) => { it.vod_pic = pics[i]; }); return items;
  }
  _is_own_host(url) { return [...this.hosts, ...HOSTS].some(host => host && url.startsWith(host)); }
  _proxy_base() {
    try { if (typeof this.getProxyUrl === 'function') { const base = String(this.getProxyUrl() || ''); if (base.startsWith('http')) return base; } } catch (e) { this._log(`getProxyUrl fail: ${e}`); }
    return '';
  }
  _proxy_pic_url(url) {
    const base = this._proxy_base(); if (!base) return '';
    const token = Buffer.from(url, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    return `${base}&url=${token}&type=img`;
  }
  _log(msg) { try { if (typeof this.log === 'function') this.log(msg); } catch {} }
  static _proxy_param_url(param) {
    let value = '';
    if (param && typeof param === 'object') value = String(param.url || '').trim();
    else {
      const text = String(param || '').trim();
      if (text.startsWith('{')) { try { value = String(JSON.parse(text).url || '').trim(); } catch {} }
      if (!value) value = (text.match(/(?:^|[?&])url=([^&]*)/) || [])[1] || '';
    }
    return restoreUrl(value);
  }

  async homeContent(filter) {
    let classes = this._parse_nav(await this._home_page()).map(([type_id, type_name]) => ({ type_id, type_name }));
    if (classes.length < 5) classes = CATEGORIES.map(([type_id, type_name]) => ({ type_id, type_name }));
    return { class: classes };
  }
  async homeVideoContent() { return { list: await this._with_pics(this._parse_cards(await this._home_page())) }; }
  async categoryContent(tid, pg, filter, extend) {
    const pageNo = Spider._to_page(pg); let slug = String(tid || '').trim().replace(/^\/+|\/+$/g, '');
    if (slug.startsWith('category/')) slug = slug.slice('category/'.length);
    const url = pageNo <= 1 ? `${this.host}/category/${slug}/` : `${this.host}/category/${slug}/${pageNo}/`;
    return this._list_result(url, pageNo);
  }
  async searchContent(key, quick, pg = '1') {
    const pageNo = Spider._to_page(pg), kw = encodeQuery(String(key || '').trim());
    if (!kw) return Spider._empty_page(pageNo);
    const url = pageNo <= 1 ? `${this.host}/search/${kw}/` : `${this.host}/search/${kw}/${pageNo}/`;
    return this._list_result(url, pageNo);
  }
  async detailContent(ids) {
    const vid = Array.isArray(ids) ? (ids[0] ?? '') : String(ids ?? ''), aid = Spider._article_id(vid);
    if (!aid) return { list: [] };
    const article = `${this.host}/archives/${aid}/`, page = await this._get(article);
    if (!page) return { list: [] };
    const name = Spider._detail_title(page), pics = [...page.matchAll(/data-xkrkllgl="([^"]+)"/g)].map(m => m[1]);
    const pic = pics.length ? await this._pic(pics[0]) : '';
    const remark = Spider._detail_date(page), videos = this._parse_videos(page);
    let playFrom, playUrl;
    if (videos.length) {
      let froms = ['默认线路'], urls = [this._episodes(videos, aid, 'h264')];
      if (this.h265 && videos.every(v => v[2])) { froms = ['H264', 'H265']; urls = [this._episodes(videos, aid, 'h264'), this._episodes(videos, aid, 'h265')]; }
      playFrom = froms.join('$$$'); playUrl = urls.join('$$$');
    } else { playFrom = '默认线路'; playUrl = `${Spider._safe('图文')}$${aid}@@0`; }
    return { list: [{ vod_id: aid, vod_name: name, vod_pic: pic, vod_remarks: remark,
      type_name: videos.length && videos[0][3] ? videos[0][3] : '', vod_content: Spider._detail_desc(page),
      vod_play_from: playFrom, vod_play_url: playUrl }] };
  }
  async playerContent(flag, id, vipFlags = null) {
    const sid = String(id || ''), parts = sid.split('@@');
    let aid = parts[0], idx = Number.parseInt(parts[1], 10), codec = parts[2] || 'h264';
    if (!Number.isFinite(idx)) idx = 0;
    const article = aid.startsWith('http') ? aid : `${this.host}/archives/${aid}/`;
    const videos = this._parse_videos(await this._get(article, this.host + '/'));
    if (videos.length) {
      if (idx < 0 || idx >= videos.length) idx = 0;
      const entry = videos[idx], url = codec === 'h265' ? (entry[2] || entry[1]) : (entry[1] || entry[2]);
      if (url) return { parse: 0, jx: 0, playUrl: '', url, header: { 'User-Agent': UA, Referer: article }, format: Spider._mime(url) };
    }
    return { parse: 1, jx: 0, playUrl: '', url: article, header: { 'User-Agent': UA, Referer: this.host + '/' } };
  }
  isVideoFormat(url) { return /\.(m3u8|mp4|m4v|flv|webm|ts)(\?|$)/i.test(String(url || '')); }
  manualVideoCheck() { return false; }

  async _home_page() {
    const now = Date.now() / 1000, [ts, text] = this._home_cache;
    if (text && now - ts < HOME_TTL) return text;
    const page = await this._get(this.host + '/'); if (page) this._home_cache = [now, page]; return page;
  }
  _swap_host(url, host) { for (const h of [...this.hosts, ...HOSTS]) if (h && url.startsWith(h)) return host + url.slice(h.length); return url; }
  static _is_bad_page(text) {
    const head = String(text || '').slice(0, 8000).toLowerCase();
    if (CHALLENGE_MARKS.some(mark => head.includes(mark))) return true;
    return String(text || '').length < STUB_MAX_LEN && STUB_MARKS.some(mark => head.includes(mark));
  }
  async _request(url, headers, timeout) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout * 1000);
    try { return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' }); }
    finally { clearTimeout(timer); }
  }
  async _get(url, referer = null, retries = FETCH_RETRIES) {
    const hosts = this.hosts.length ? [...this.hosts] : [this.host]; let last = null;
    for (let i = 0; i < Math.max(1, retries); i++) {
      const host = hosts[i % hosts.length], target = this._swap_host(url, host), headers = { ...this.headers };
      headers.Referer = referer ? this._swap_host(referer, host) : host + '/';
      try {
        const rsp = await this._request(target, headers, FETCH_TIMEOUT), text = await rsp.text();
        if (text && rsp.status === 200 && !Spider._is_bad_page(text)) { this.host = host; return text; }
        last = text ? `HTTP ${rsp.status}` : 'empty body';
      } catch (e) { last = e; }
      if (i < retries - 1) await sleep(1000);
    }
    this._log(`fetch fail: ${url} -> ${last}`); return '';
  }
  _parse_nav(page) {
    if (!page) return [];
    const seen = new Set(), out = [];
    for (const m of page.matchAll(/<a[^>]+href="\/category\/([A-Za-z0-9_-]+)\/"[^>]*>([\s\S]{1,120}?)<\/a>/g)) {
      const slug = m[1], name = this._clean(m[2]);
      if (slug && name && name.length <= 20 && !seen.has(slug)) { seen.add(slug); out.push([slug, name]); }
    }
    return out;
  }
  _parse_cards(page) {
    if (!page) return [];
    const marks = [...page.matchAll(/id="post-card-(\d+)"/g)], items = [];
    for (let i = 0; i < marks.length; i++) {
      const vid = marks[i][1], start = marks[i].index, end = i + 1 < marks.length ? marks[i + 1].index : page.length, seg = page.slice(start, end);
      const tm = seg.match(/<h2 class="post-card-title"[^>]*>([\s\S]*?)<\/h2>/), title = tm ? this._clean(tm[1]) : '';
      if (!title) continue;
      const pm = seg.match(/loadBannerDirect\(\s*['"]([^'"]+)['"]/), pic = pm ? pm[1].trim() : '';
      const dm = seg.match(/itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})/), date = dm ? dm[1] : '';
      const cm = seg.match(/itemprop="datePublished"[^>]*>\s*[^<]*<\/span>\s*<span>([^<]{1,60})<\/span>/);
      const cate = cm ? htmlUnescape(cm[1]).trim() : '';
      items.push({ vod_id: vid, vod_name: title, vod_pic: pic, vod_remarks: date, type_name: cate });
    }
    return items;
  }
  _parse_videos(page) {
    if (!page) return [];
    const seg = Spider._content_segment(page), out = [];
    for (const m of seg.matchAll(/data-config='([^']*)'/g)) {
      const cfg = Spider._json_attr(m[1]); if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
      const h264 = Spider._stream_url(cfg.video), h265 = Spider._stream_url(cfg.video_h265);
      if (!h264 && !h265) continue;
      const head = seg.slice(Math.max(0, m.index - 2500), m.index);
      const tm = [...head.matchAll(/data-video_title="([^"]*)"/g)], km = [...head.matchAll(/data-video_type_name="([^"]*)"/g)];
      out.push([tm.length ? htmlUnescape(tm[tm.length - 1][1]).trim() : '', h264, h265, km.length ? htmlUnescape(km[km.length - 1][1]).trim() : '']);
    }
    return out;
  }
  static _stream_url(node) {
    if (node && typeof node === 'object' && !Array.isArray(node)) return htmlUnescape(String(node.url || ''));
    if (Array.isArray(node)) { const item = node.find(x => x && typeof x === 'object' && x.url); if (item) return htmlUnescape(String(item.url)); }
    return '';
  }
  static _json_attr(raw) { for (const candidate of [raw, htmlUnescape(raw)]) { try { return JSON.parse(candidate); } catch {} } return null; }
  _episodes(videos, aid, codec) { return videos.map((v, i) => `${Spider._safe(v[0] || `第${i + 1}集`)}$${aid}@@${i}@@${codec}`).join('#'); }
  static _content_segment(page) {
    const s = page.indexOf('<div class="post-content"'); if (s < 0) return page;
    let e = page.length; for (const mark of ['<div id="body-bottom"', 'class="post-near"', '<footer']) { const j = page.indexOf(mark, s); if (j > 0) e = Math.min(e, j); }
    return page.slice(s, e);
  }
  static _detail_title(page) {
    let m = page.match(/<meta property="og:title" content="([^"]+)"/); if (m) return htmlUnescape(m[1]).trim();
    m = page.match(/<h1[^>]*>([\s\S]{1,200}?)<\/h1>/); return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  }
  static _detail_date(page) {
    let m = page.match(/itemprop="dateModified"\s+content="(\d{4}-\d{2}-\d{2})/); if (m) return m[1];
    m = page.match(/itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})/); return m ? m[1] : '';
  }
  static _detail_desc(page, limit = 300) {
    let m = page.match(/<meta property="og:description" content="([^"]*)"/); if (!m) m = page.match(/<meta name="description" content="([^"]*)"/);
    if (m) { const desc = htmlUnescape(m[1]).replace(/\s+/g, ' ').trim(); if (desc) return Array.from(desc).slice(0, limit).join(''); }
    let text = Spider._content_segment(page).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<div class="article-ads-btn"[\s\S]*?<\/div>/i, '').replace(/<[^>]+>/g, ' ');
    text = htmlUnescape(text).replace(/\s+/g, ' ').trim(); return Array.from(text).slice(0, limit).join('');
  }
  async _list_result(url, pageNo) {
    const page = await this._get(url); if (!page) return Spider._empty_page(pageNo);
    const items = this._parse_cards(page);
    if (!items.length && /id="post-card-\d+"/.test(page)) { this._log(`parse fail: ${url} -> 锚点在但结果为空`); return Spider._empty_page(pageNo); }
    return { list: await this._with_pics(items), page: pageNo, pagecount: Spider._pagecount(page, pageNo, items.length), limit: PAGE_SIZE };
  }
  static _pagecount(page, pageNo, got) {
    const m = String(page || '').match(/page-info[^>]*>\s*(\d+)\s*\/\s*(\d+)/);
    if (m) { const total = Number(m[2]); if (total >= 1) return Math.max(total, pageNo); }
    return got >= PAGE_SIZE ? pageNo + 1 : pageNo;
  }
  static _empty_page(pageNo) { return { list: [], page: pageNo, pagecount: pageNo, limit: PAGE_SIZE }; }
  static _article_id(vid) {
    const s = String(vid || '').trim(); let m = s.match(/\/archives\/(\d+)/); if (m) return m[1];
    if (/^\d+$/.test(s)) return s; m = s.match(/(\d{3,})/); return m ? m[1] : '';
  }
  static _to_page(pg) { const n = Number.parseInt(String(pg), 10); return Number.isFinite(n) ? Math.max(n, 1) : 1; }
  static _pic_mode_inline(ext) {
    const mode = String(ext.pic || ext.pic_mode || '').trim().toLowerCase(); if (mode) return ['inline', 'data', 'datauri'].includes(mode);
    if (Object.prototype.hasOwnProperty.call(ext, 'inline_pic')) { const v = ext.inline_pic; return typeof v === 'string' ? !['0', 'false', 'no', 'off', ''].includes(v.trim().toLowerCase()) : Boolean(v); }
    return INLINE_PIC;
  }
  static _ext_proxies(ext) {
    let value = ext.proxies;
    if (typeof value === 'string' && value.trim()) value = { http: value.trim(), https: value.trim() };
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = Object.fromEntries(['http', 'https', 'all'].filter(k => typeof ext[k] === 'string' && ext[k].trim()).map(k => [k, ext[k]]));
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [String(k), String(v)]));
  }
  static _parse_ext(extend) {
    if (extend && typeof extend === 'object' && !Array.isArray(extend)) return { ...extend };
    if (typeof extend === 'string' && extend.trim()) {
      try { const data = JSON.parse(extend); if (data && typeof data === 'object' && !Array.isArray(data)) return data; } catch {}
      try { return Object.fromEntries(new URLSearchParams(extend)); } catch {}
    }
    return {};
  }
  static _clean(value) { return htmlUnescape(String(value || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
  static _safe(value) { return String(value || '').replace(/\s+/g, ' ').replace(/\$/g, '\uff04').replace(/#/g, '\uff03').trim(); }
  static _mime(url) {
    const path = String(url || '').split(/[?#]/, 1)[0].toLowerCase();
    if (path.endsWith('.mp4')) return 'video/mp4'; if (path.endsWith('.flv')) return 'video/x-flv';
    if (path.endsWith('.webm')) return 'video/webm'; if (path.endsWith('.m4v')) return 'video/x-m4v';
    return 'application/x-mpegURL';
  }
}

module.exports = { Spider, HOSTS, HOST, UA };
