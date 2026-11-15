// M365 Radar — ingest every source, score, merge with the previous snapshot, write public/data.json
// Node 20+, zero dependencies. Run: node scripts/ingest.mjs
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (compatible; InnovaticT-M365-Radar/1.0; +https://innovatict.com)';
const DAY = 86400000;
const NOW = Date.now();
const OUT = new URL('../public/data.json', import.meta.url);

// ---------- sources ----------
const TC = (board) => `https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=${board}`;
const REDDIT_HIRE_SUBS = 'forhire+freelance_forhire+jobbit+sysadminjobs+RemoteJobs+hiring+techjobs';
const REDDIT_COMMUNITY_SUBS = 'Office365+sharepoint+microsoft365+PowerApps+MicrosoftFlow+PowerAutomate+msp+sysadmin+Intune+MicrosoftTeams';
const SKILL_Q = '(sharepoint OR "microsoft 365" OR "office 365" OR m365 OR o365 OR intune OR "power automate" OR "power apps" OR "power platform" OR "exchange online" OR "teams" OR "tenant migration" OR copilot)';
const INTENT_Q = '(hiring OR "looking for" OR consultant OR freelancer OR contractor OR trainer OR "need help" OR "paid")';
const rss = (q) => encodeURIComponent(q);

export const SOURCES = [
  // Service health
  { id: 'azure-status', name: 'Azure Status (active incidents)', cat: 'health', type: 'rss', url: 'https://azure.status.microsoft/en-us/status/feed/' },
  // Message Center (public mirror; your tenant via Graph below if secrets are set)
  { id: 'mc-merill', name: 'Message Center (mc.merill.net)', cat: 'mc', type: 'rss', url: 'https://mc.merill.net/rss.xml', max: 150, exclude: /dynamics 365|business central|field service/i },
  // Roadmap
  { id: 'm365-roadmap', name: 'Microsoft 365 Roadmap', cat: 'roadmap', type: 'rss', url: 'https://www.microsoft.com/releasecommunications/api/v1/m365/rss', maxAgeDays: 30, max: 250, exclude: /dynamics 365|business central/i },
  // Official blogs
  { id: 'm365-blog', name: 'Microsoft 365 Blog', cat: 'blog', type: 'rss', url: 'https://www.microsoft.com/en-us/microsoft-365/blog/feed/' },
  { id: 'tc-all', name: 'Tech Community (all blogs)', cat: 'blog', type: 'rss', url: 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/Community?interaction.style=blog&feeds.replies=false', max: 60 },
  { id: 'tc-m365', name: 'Tech Community · Microsoft 365', cat: 'blog', type: 'rss', url: TC('microsoft_365blog') },
  { id: 'tc-sp', name: 'Tech Community · SharePoint', cat: 'blog', type: 'rss', url: TC('SPBlog') },
  { id: 'tc-teams', name: 'Tech Community · Teams', cat: 'blog', type: 'rss', url: TC('MicrosoftTeamsBlog') },
  { id: 'tc-exchange', name: 'Tech Community · Exchange', cat: 'blog', type: 'rss', url: TC('Exchange') },
  { id: 'tc-onedrive', name: 'Tech Community · OneDrive', cat: 'blog', type: 'rss', url: TC('OneDriveBlog') },
  { id: 'tc-intune', name: 'Tech Community · Intune', cat: 'blog', type: 'rss', url: TC('microsoftintuneblog') },
  { id: 'tc-entra', name: 'Tech Community · Entra', cat: 'blog', type: 'rss', url: TC('microsoft-entra-blog') },
  { id: 'm365-dev', name: 'Microsoft 365 Developer Blog', cat: 'blog', type: 'rss', url: 'https://devblogs.microsoft.com/microsoft365dev/feed/' },
  { id: 'pp-blog', name: 'Power Platform Blog', cat: 'blog', type: 'rss', url: 'https://www.microsoft.com/en-us/power-platform/blog/feed/' },
  // Leads — freelance & jobs
  { id: 'reddit-hire', name: 'Reddit · hiring subs', cat: 'leads', type: 'reddit', subs: REDDIT_HIRE_SUBS, q: SKILL_Q },
  { id: 'reddit-comm', name: 'Reddit · M365 communities', cat: 'leads', type: 'reddit', subs: REDDIT_COMMUNITY_SUBS, q: INTENT_Q },
  { id: 'freelancer', name: 'Freelancer.com projects', cat: 'leads', type: 'freelancer',
    queries: ['sharepoint', 'microsoft 365', 'office 365', 'power automate', 'power apps', 'intune', 'exchange online', 'microsoft teams', 'tenant migration', 'onedrive migration', 'm365 training'] },
  { id: 'hn', name: 'Hacker News · hiring threads', cat: 'leads', type: 'hn', queries: ['sharepoint', '"microsoft 365"', '"office 365"', '"power platform"', 'intune', 'm365'] },
  { id: 'remotive', name: 'Remotive remote jobs', cat: 'leads', type: 'remotive', queries: ['sharepoint', 'microsoft 365', 'office 365', 'power platform', 'intune'] },
  { id: 'remoteok', name: 'RemoteOK', cat: 'leads', type: 'remoteok', url: 'https://remoteok.com/api' },
  { id: 'wwr', name: 'We Work Remotely · DevOps/SysAdmin', cat: 'leads', type: 'rss', url: 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss', filterSkill: true },
];

// ---------- tagging & scoring ----------
const PRODUCTS = [
  ['SharePoint', /sharepoint|spo\b|spmt/i], ['Teams', /\bteams\b/i], ['Exchange', /exchange|outlook|mailbox/i],
  ['OneDrive', /onedrive/i], ['Entra', /entra|azure ad|\baad\b|conditional access/i], ['Intune', /intune|endpoint manager|autopilot/i],
  ['Purview', /purview|dlp\b|sensitivity label|retention|ediscovery/i], ['Copilot', /copilot/i],
  ['Power Platform', /power ?apps|power ?automate|power platform|power bi|dataverse|copilot studio/i],
  ['Viva', /\bviva\b/i], ['Defender', /defender/i], ['Migration', /migrat|cross-tenant|tenant-to-tenant|quest|sharegate|\bodm\b/i],
];
const EVENT_RX = /\b(webinar|ama\b|ask microsoft anything|conference|summit|ignite|build 20|espc|community call|live event|register|keynote|workshop|meetup|bootcamp|hackathon|event)\b/i;
const INTENT = [/\[hiring\]/i, /\bhiring\b/i, /looking for (a|an|someone|freelanc|consult|contract|help|expert)/i, /\bneed (a|an|someone|help|expert)\b/i,
  /\bseeking\b/i, /\bfreelanc/i, /\bcontract(or)?\b/i, /\bconsultant\b/i, /\btrainer\b|\btraining\b/i, /\bbudget\b|\$\d|usd|€\d|£\d|per hour|\/hr/i, /\bpaid\b/i, /\bremote\b/i];
const SKILL = /sharepoint|microsoft 365|office 365|\bm365\b|\bo365\b|intune|power ?automate|power ?apps|power platform|exchange online|microsoft teams|\bms teams\b|entra id|microsoft entra|onedrive|purview|azure ad|copilot studio|m365 copilot|microsoft 365 copilot|\bspfx\b|dataverse|tenant[- ]to[- ]tenant|cross[- ]tenant|microsoft 365 migration/i;
const OFFERING = /\[for hire\]|^for hire|\bi am available\b|\bavailable for (hire|work)\b|\bhire me\b|\bmy services\b/i;
const ROLES = [['Trainer', /trainer|training|teach|workshop|enablement|adoption/i], ['Migration', /migrat|cross-tenant|tenant-to-tenant|move .* to (sharepoint|onedrive|m365)/i],
  ['Architect / Lead', /architect|\blead\b|governance|strategy|design/i], ['Admin', /admin|support|helpdesk|intune|exchange|licen/i], ['Developer', /develop|spfx|power ?apps|power ?automate|graph api|\bapi\b|flow/i]];

const productsOf = (t) => PRODUCTS.filter(([, rx]) => rx.test(t)).map(([n]) => n);
function scoreLead(text) {
  if (OFFERING.test(text)) return -10;
  if (!SKILL.test(text)) return 0; // must actually be about Microsoft 365
  let s = 0;
  for (const rx of INTENT) if (rx.test(text)) s += 2;
  const skills = (text.match(new RegExp(SKILL.source, 'gi')) || []).length;
  s += Math.min(skills, 4) * 2;
  return s;
}

// ---------- tiny XML helpers ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const strip = (s = '') => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };
const tags = (block, name) => [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => strip(m[1]));
const attr = (block, name, a) => { const m = block.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]*)"`, 'i')); return m ? decode(m[1]) : ''; };
const toTime = (s) => { const t = Date.parse(String(s).trim().replace(/ Z$/, ' GMT')); return Number.isFinite(t) ? t : NOW; };
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  return blocks.map((b) => {
    const link = isAtom ? (attr(b, 'link', 'href') || strip(tag(b, 'id'))) : (strip(tag(b, 'link')) || strip(tag(b, 'guid')));
    return {
      title: strip(tag(b, 'title')),
      url: link,
      guid: strip(tag(b, 'guid')) || strip(tag(b, 'id')) || link,
      date: toTime(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'a10:updated') || tag(b, 'published') || tag(b, 'dc:date')),
      updated: toTime(tag(b, 'a10:updated') || tag(b, 'updated') || tag(b, 'pubDate')),
      summary: strip(tag(b, 'description') || tag(b, 'content') || tag(b, 'summary')).slice(0, 420),
      categories: [...tags(b, 'category'), ...[...b.matchAll(/<category[^>]*term="([^"]+)"/gi)].map((m) => decode(m[1]))],
      author: strip(tag(b, 'author') || tag(b, 'dc:creator')).replace(/^\/u\//, 'u/'),
    };
  });
}

// ---------- fetch ----------
async function get(url, { json = false, headers = {}, timeout = 25000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return json ? r.json() : r.text();
  } finally { clearTimeout(t); }
}

const item = (src, o) => {
  const text = `${o.title} ${o.summary || ''}`;
  const products = [...new Set([...(o.products || []), ...productsOf(`${text} ${(o.categories || []).join(' ')}`)])];
  const it = { id: `${src.id}:${hash(o.guid || o.url || o.title)}`, src: src.id, srcName: src.name, cat: src.cat, title: o.title, url: o.url,
    summary: o.summary || '', date: o.date || NOW, products, meta: o.meta || {} };
  if (src.cat === 'leads') {
    it.score = scoreLead(text);
    it.roles = ROLES.filter(([, rx]) => rx.test(text)).map(([n]) => n);
  }
  if (src.cat === 'blog' && EVENT_RX.test(o.title)) it.event = true;
  return it;
};

const runners = {
  async rss(src) {
    let rows = parseFeed(await get(src.url));
    if (src.maxAgeDays) rows = rows.filter((r) => NOW - Math.max(r.date, r.updated) < src.maxAgeDays * DAY);
    if (src.exclude) rows = rows.filter((r) => !src.exclude.test(`${r.title} ${r.categories.join(' ')}`));
    if (src.filterSkill) rows = rows.filter((r) => SKILL.test(`${r.title} ${r.summary}`));
    rows = rows.slice(0, src.max || 40);
    return rows.map((r) => {
      const meta = {};
      if (src.id === 'm365-roadmap') {
        meta.status = r.categories.find((c) => /in development|rolling out|launched/i.test(c)) || '';
        meta.release = r.categories.find((c) => /general availability|preview|targeted release/i.test(c)) || '';
        meta.rid = r.guid; meta.ga = (r.summary.match(/GA date:?\s*([A-Za-z]+ \d{4})/i) || [])[1] || '';
        r.date = Math.max(r.date, r.updated);
      }
      if (src.id === 'mc-merill') meta.mc = (r.title.match(/^MC\d+/) || [])[0] || '';
      if (src.id === 'azure-status') meta.severity = 'incident';
      if (r.author) meta.author = r.author;
      return item(src, { ...r, products: src.id === 'm365-roadmap' ? productsOf(`${r.title.split(':')[0]} ${r.categories.join(' ')}`) : [], meta });
    });
  },
  async freelancer(src) {
    const out = [];
    for (const q of src.queries) {
      const j = await get(`https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(q)}&limit=20&sort_field=time_updated&full_description=true&job_details=true`, { json: true });
      for (const p of j?.result?.projects || []) {
        const b = p.budget || {}; const cur = p.currency?.code || '';
        out.push(item(src, { guid: String(p.id), title: p.title, url: `https://www.freelancer.com/projects/${p.seo_url}`, summary: (p.preview_description || p.description || '').slice(0, 420),
          date: (p.time_submitted || 0) * 1000, meta: { budget: b.minimum ? `${cur} ${b.minimum}${b.maximum ? '–' + b.maximum : '+'}${p.type === 'hourly' ? '/hr' : ''}` : '', bids: p.bid_stats?.bid_count ?? '', query: q } }));
      }
    }
    return out.map((o) => (o.score > 0 ? { ...o, score: o.score + 4 } : o)); // a posted project is explicit buyer intent
  },
  async hn(src) {
    const out = [];
    for (const q of src.queries) {
      const j = await get(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=comment&numericFilters=created_at_i>${Math.floor((NOW - 45 * DAY) / 1000)}&hitsPerPage=50`, { json: true });
      for (const h of j.hits || []) {
        if (!/hiring|freelancer|seeking/i.test(h.story_title || '')) continue;
        const text = strip(h.comment_text || '');
        out.push(item(src, { guid: h.objectID, title: text.split(/[.|\n]/)[0].slice(0, 140) || h.story_title, url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          summary: text.slice(0, 420), date: h.created_at_i * 1000, meta: { thread: h.story_title, author: h.author } }));
      }
    }
    return out;
  },
  async reddit(src) {
    const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: sec } = process.env;
    let posts;
    if (id && sec) {
      const tok = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'grant_type=client_credentials' }).then((r) => r.json());
      if (!tok.access_token) throw new Error('Reddit OAuth failed — check REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET');
      const j = await get(`https://oauth.reddit.com/r/${src.subs}/search?q=${encodeURIComponent(src.q)}&restrict_sr=on&sort=new&t=month&limit=100&raw_json=1`,
        { json: true, headers: { Authorization: `Bearer ${tok.access_token}` } });
      posts = (j.data?.children || []).map((c) => c.data).map((d) => ({ guid: d.name, title: d.title, url: `https://www.reddit.com${d.permalink}`,
        summary: (d.selftext || '').slice(0, 420), date: d.created_utc * 1000, meta: { author: `u/${d.author}`, sub: `r/${d.subreddit}`, comments: d.num_comments } }));
    } else {
      try {
        posts = parseFeed(await get(`https://www.reddit.com/r/${src.subs}/search.rss?q=${encodeURIComponent(src.q)}&restrict_sr=on&sort=new&t=month`))
          .map((r) => ({ ...r, meta: { author: r.author, sub: (r.url.match(/\/r\/([^/]+)/) || [])[0]?.slice(1) || '' } }));
      } catch (e) { throw new Error(`${e.message} — Reddit blocks cloud IPs; add REDDIT_CLIENT_ID/SECRET (see README)`); }
    }
    return posts.map((p) => item(src, p));
  },
  async remotive(src) {
    const out = [];
    for (const q of src.queries) {
      const j = await get(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=30`, { json: true });
      for (const x of j.jobs || []) out.push(item(src, { guid: String(x.id), title: `${x.title} — ${x.company_name}`, url: x.url, summary: strip(x.description).slice(0, 420),
        date: Date.parse(x.publication_date) || NOW, meta: { budget: x.salary || '', type: x.job_type || '', where: x.candidate_required_location || '' } }));
    }
    return out;
  },
  async remoteok(src) {
    const j = await get(src.url, { json: true });
    return (Array.isArray(j) ? j : []).filter((x) => x.id && SKILL.test(`${x.position} ${(x.tags || []).join(' ')} ${x.description || ''}`)).slice(0, 40)
      .map((x) => item(src, { guid: String(x.id), title: `${x.position} — ${x.company}`, url: x.url, summary: strip(x.description || '').slice(0, 420),
        date: (x.epoch || 0) * 1000 || NOW, meta: { budget: x.salary_min ? `USD ${x.salary_min}–${x.salary_max}` : '', where: x.location || '' } }));
  },
};

// ---------- optional: your own tenant via Microsoft Graph ----------
async function graphSources() {
  const { M365_TENANT_ID: t, M365_CLIENT_ID: c, M365_CLIENT_SECRET: s } = process.env;
  if (!t || !c || !s) return { items: [], status: [], health: null };
  const status = []; const items = []; let health = null;
  const t0 = Date.now();
  try {
    const tok = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c, client_secret: s, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) }).then((r) => r.json());
    if (!tok.access_token) throw new Error(tok.error_description?.split('\r')[0] || 'token failed');
    const H = { Authorization: `Bearer ${tok.access_token}` };
    const ov = await get('https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews', { json: true, headers: H });
    health = (ov.value || []).map((x) => ({ service: x.service, status: x.status }));
    const iss = await get(`https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/issues?$filter=isResolved eq false&$top=100`, { json: true, headers: H });
    const src = { id: 'tenant-health', name: 'Your tenant · Service health', cat: 'health' };
    for (const x of iss.value || []) items.push(item(src, { guid: x.id, title: `${x.id}: ${x.title}`, url: 'https://admin.microsoft.com/#/servicehealth',
      summary: x.impactDescription || '', date: Date.parse(x.lastModifiedDateTime) || NOW, products: [], meta: { severity: x.classification, service: x.service, status: x.status } }));
    const msg = await get(`https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/messages?$orderby=lastModifiedDateTime desc&$top=100`, { json: true, headers: H });
    const msrc = { id: 'tenant-mc', name: 'Your tenant · Message Center', cat: 'mc' };
    for (const x of msg.value || []) items.push(item(msrc, { guid: x.id, title: `${x.id}: ${x.title}`, url: `https://admin.microsoft.com/#/MessageCenter/:/messages/${x.id}`,
      summary: strip(x.body?.content || '').slice(0, 420), date: Date.parse(x.lastModifiedDateTime) || NOW, categories: x.services || [],
      meta: { mc: x.id, actBy: x.actionRequiredByDateTime || '', major: x.isMajorChange || false } }));
    status.push({ id: 'tenant-graph', name: 'Your tenant (Microsoft Graph)', cat: 'health', ok: true, count: items.length, ms: Date.now() - t0 });
  } catch (e) { status.push({ id: 'tenant-graph', name: 'Your tenant (Microsoft Graph)', cat: 'health', ok: false, count: 0, error: String(e.message || e), ms: Date.now() - t0 }); }
  return { items, status, health };
}

// ---------- main ----------
async function main() {
  const results = await Promise.all(SOURCES.map(async (src) => {
    const t0 = Date.now();
    try { const rows = await runners[src.type](src); return { src, rows, st: { id: src.id, name: src.name, cat: src.cat, ok: true, count: rows.length, ms: Date.now() - t0 } }; }
    catch (e) { return { src, rows: [], st: { id: src.id, name: src.name, cat: src.cat, ok: false, count: 0, error: String(e.message || e), ms: Date.now() - t0 } }; }
  }));
  const graph = await graphSources();

  let fresh = [...results.flatMap((r) => r.rows), ...graph.items].filter((x) => x.title && x.url);
  fresh = fresh.filter((x) => x.cat !== 'leads' || x.score >= 4);

  // merge with previous snapshot so items that roll off a source stay visible for a while
  let prev = [];
  const prevUrl = process.env.PREV_DATA_URL;
  try {
    const old = prevUrl ? await get(prevUrl, { json: true, timeout: 15000 }) : JSON.parse(await readFile(OUT, 'utf8'));
    prev = old.items || [];
  } catch { /* first run */ }
  const okSources = new Set(results.filter((r) => r.st.ok).map((r) => r.src.id));
  const keepDays = { leads: 30, health: 3, mc: 45, roadmap: 30, blog: 45 };
  const map = new Map();
  for (const x of prev) {
    if (x.cat === 'health' && okSources.has(x.src)) continue; // health is "current state": drop resolved incidents
    if (x.src.startsWith('tenant-') && graph.status[0]?.ok) continue;
    if (NOW - x.date < (keepDays[x.cat] || 30) * DAY) map.set(x.id, { ...x, firstSeen: x.firstSeen || x.date });
  }
  for (const x of fresh) map.set(x.id, { ...x, firstSeen: map.get(x.id)?.firstSeen || NOW });

  // de-duplicate leads cross-posted to several subs/queries
  const seenTitle = new Set();
  const items = [...map.values()].sort((a, b) => b.date - a.date).filter((x) => {
    if (x.cat !== 'leads') return true;
    const k = x.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seenTitle.has(k)) return false; seenTitle.add(k); return true;
  });

  const data = { generated_at: new Date(NOW).toISOString(), next_run_minutes: 15, tenant_health: graph.health,
    sources: [...results.map((r) => r.st), ...graph.status], items };
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  const by = items.reduce((a, x) => ((a[x.cat] = (a[x.cat] || 0) + 1), a), {});
  console.log('items by category:', by);
  for (const s of data.sources) console.log(`${s.ok ? '✓' : '✗'} ${s.name.padEnd(40)} ${String(s.count).padStart(4)}  ${s.ms}ms ${s.error || ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
