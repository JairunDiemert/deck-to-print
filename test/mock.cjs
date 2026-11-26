/* A stand-in for Scryfall, used only by the automated tests.
   It answers the same requests with made-up cards and plain placeholder pictures drawn here,
   so the tests need no network and use no real card images. */
const sharp = require('sharp');

const SETS = ['c21', 'clb', 'znr', 'isd', 'm21', '2x2', 'cmr', 'mh2', 'tst', 'wht', 'bdl', 'plst', 'ust', 'cmm', '2xm'];
const BASICS = ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'];
const DOUBLE = {
  'delver of secrets // insectile aberration': ['Delver of Secrets', 'Insectile Aberration'],
  'day side // night side': ['Day Side', 'Night Side'],
  'sun face // moon face': ['Sun Face', 'Moon Face'],
  'left door // right door': ['Left Door', 'Right Door']
};
const SPLIT = { 'fire // ice': ['Fire', 'Ice'] };
/* Checked against the live service: the bulk lookup finds a two-part card by either part's name
   ("Fire", "Delver of Secrets", "Insectile Aberration") but not by its full "A // B" name.
   The forgiving one-at-a-time search does understand the full name, and typos. */
const PART = {};
Object.keys(DOUBLE).forEach((k) => DOUBLE[k].forEach((n) => { PART[n.toLowerCase()] = DOUBLE[k].join(' // '); }));
Object.keys(SPLIT).forEach((k) => SPLIT[k].forEach((n) => { PART[n.toLowerCase()] = SPLIT[k].join(' // '); }));
const TYPO = { 'sol rng': 'Sol Ring', 'cultivte': 'Cultivate', 'sol rg': 'Oathsworn Giant' };   // the last one is a wild guess, like the live service sometimes gives

const registry = new Map();   // image id -> { name, style, hue }
const imageCache = new Map();

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function titleCase(s) { return s.replace(/\S+/g, (w) => (/^(of|the|to|a|and)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).replace(/^./, (c) => c.toUpperCase()); }

const BORDER = { black: '#15110f', white: '#f1f0ea' };

/* Placeholder picture: a plain frame, a title, abstract shapes and the words TEST IMAGE. */
function cardSvg(spec, w, h) {
  const k = w / 745;
  const hue = spec.hue;
  const border = spec.style === 'borderless' ? null : BORDER[spec.style] || BORDER.black;
  const r = 36 * k;
  const ink = spec.style === 'white' ? '#222' : '#eee';
  const b = 30 * k;
  const frame = spec.style === 'borderless'
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="0.5" stop-color="hsl(${(hue + 60) % 360},65%,58%)"/><stop offset="1" stop-color="hsl(${(hue + 150) % 360},70%,32%)"/></linearGradient>
       <pattern id="p" width="${46 * k}" height="${46 * k}" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><rect width="${23 * k}" height="${46 * k}" fill="rgba(255,255,255,0.16)"/></pattern></defs>
       <rect width="${w}" height="${h}" rx="${r}" fill="url(#g)"/><rect width="${w}" height="${h}" rx="${r}" fill="url(#p)"/>`
    : `<rect width="${w}" height="${h}" rx="${r}" fill="${border}"/>
       <rect x="${b}" y="${b}" width="${w - 2 * b}" height="${h - b - 62 * k}" rx="${10 * k}" fill="hsl(${hue},32%,62%)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${frame}
    <rect x="${44 * k}" y="${44 * k}" width="${w - 88 * k}" height="${58 * k}" rx="${8 * k}" fill="hsl(${hue},40%,88%)" stroke="#222" stroke-width="${2 * k}"/>
    <text x="${60 * k}" y="${84 * k}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${30 * k}" fill="#111">${esc(spec.name.slice(0, 30))}</text>
    <rect x="${52 * k}" y="${116 * k}" width="${w - 104 * k}" height="${460 * k}" fill="hsl(${(hue + 30) % 360},45%,40%)" stroke="#222" stroke-width="${2 * k}"/>
    <circle cx="${w * 0.36}" cy="${330 * k}" r="${120 * k}" fill="hsl(${(hue + 190) % 360},60%,70%)"/>
    <path d="M${w * 0.5} ${210 * k} L${w * 0.82} ${520 * k} L${w * 0.3} ${520 * k} Z" fill="hsl(${(hue + 300) % 360},55%,55%)" opacity="0.85"/>
    <text x="${w / 2}" y="${555 * k}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${26 * k}" fill="#fff">TEST IMAGE</text>
    <rect x="${44 * k}" y="${590 * k}" width="${w - 88 * k}" height="${50 * k}" rx="${8 * k}" fill="hsl(${hue},40%,88%)" stroke="#222" stroke-width="${2 * k}"/>
    <text x="${60 * k}" y="${624 * k}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${24 * k}" fill="#111">Placeholder (${esc(spec.style)})</text>
    <rect x="${52 * k}" y="${654 * k}" width="${w - 104 * k}" height="${300 * k}" fill="hsl(${hue},30%,93%)" stroke="#222" stroke-width="${2 * k}"/>
    <text x="${70 * k}" y="${700 * k}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${24 * k}" fill="#111">Not a real card. Made for testing.</text>
    <text x="${70 * k}" y="${740 * k}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${24 * k}" fill="#c0102e">Red text checks colour edges.</text>
    <text x="${44 * k}" y="${1012 * k}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${18 * k}" fill="${ink}">TEST 001 placeholder artist</text>
    <text x="${w - 44 * k}" y="${1012 * k}" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="${18 * k}" fill="${ink}">test copyright line</text>
  </svg>`;
}

async function image(id, size) {
  const key = id + '|' + size;
  if (imageCache.has(key)) return imageCache.get(key);
  const spec = registry.get(id) || { name: 'Unknown', style: 'black', hue: 0 };
  const dims = size === 'png' ? [/narrow/i.test(spec.name) ? 744 : 745, 1040] : size === 'normal' ? [488, 680] : [146, 204];
  const svg = Buffer.from(cardSvg(spec, dims[0], dims[1]));
  const img = sharp(svg, { density: 72 });
  const buf = size === 'png' ? await img.png().toBuffer() : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
  imageCache.set(key, buf);
  return buf;
}

function uris(id) {
  return {
    small: `https://cards.scryfall.io/small/front/${id}.jpg?1`,
    normal: `https://cards.scryfall.io/normal/front/${id}.jpg?1`,
    large: `https://cards.scryfall.io/large/front/${id}.jpg?1`,
    png: `https://cards.scryfall.io/png/front/${id}.png?1`
  };
}

function register(name, style) {
  const id = slug(name) + '-' + style;
  if (!registry.has(id)) registry.set(id, { name, style, hue: hash(name) % 360 });
  return id;
}

const ARTISTS = { tst: 'Ann Example', bdl: 'Bo Sample', wht: 'Cy Oldham', znr: 'Ann Example', cmm: 'Dee Digital', c21: 'Eve Nopic' };

/* Cards that can lead a deck, for the "start from a commander" search. */
const COMMANDERS = ["Atraxa, Praetors' Voice", 'Atraxa, Grand Unifier', 'Kaalia of the Vast', 'Zzz Nodeck, the Unlisted'];

/* A small ready-made deck in MTGJSON's shape: a commander, single cards, a card with copies,
   a two-sided card, a card whose set and number are unknown to the stand-in, and one printed
   with the same face on both sides. */
function mtgjsonDeck(file) {
  const card = (name, count, setCode, number) => ({ name, count, setCode, number, isFoil: false });
  return {
    meta: { date: '2026-01-01', version: 'test' },
    data: {
      code: 'C16', name: 'Stand-in Deck', type: 'Commander Deck', releaseDate: '2016-11-11', fileName: file,
      commander: [card("Atraxa, Praetors' Voice", 1, 'C16', '28')],
      mainBoard: [
        card('Sol Ring', 1, 'C16', '272'), card('Command Tower', 1, 'C16', '286'), card('Island', 3, 'C16', '340'),
        card('Delver of Secrets // Insectile Aberration', 1, 'ISD', '51'), card('Arcane Signet', 1, 'PLST', 'ELD-331'),
        card('Twin Face // Twin Face', 1, 'SLD', '900')
      ],
      sideBoard: [], tokens: [card('Germ', 1, 'TC16', '10')]
    }
  };
}

function makeCard(properName, opts) {
  opts = opts || {};
  const key = properName.toLowerCase();
  const set = opts.set || 'tst';
  const style = opts.style || (set === 'wht' ? 'white' : (set === 'bdl' || /borderless/i.test(properName)) ? 'borderless' : 'black');
  const base = {
    object: 'card',
    id: 'id-' + slug(properName) + '-' + set + '-' + (opts.cn || '1'),
    oracle_id: 'oracle-' + slug(properName),
    name: properName,
    lang: 'en',
    released_at: opts.released || '2024-01-01',
    layout: 'normal',
    set: set,
    set_name: 'Test Set ' + set.toUpperCase(),
    collector_number: String(opts.cn || '1'),
    digital: !!opts.digital,
    border_color: style === 'white' ? 'white' : style === 'borderless' ? 'borderless' : 'black',
    artist: ARTISTS[set] || 'Ann Example',
    frame: set === 'wht' ? '1993' : '2015',
    image_status: 'highres_scan',
    type_line: BASICS.includes(key) ? 'Basic Land \u2014 ' + properName : 'Artifact',
    prints_search_uri: 'https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aoracle-' + slug(properName) + '&unique=prints'
  };
  if (/no picture/i.test(properName) || opts.noImage) {
    base.image_status = 'missing';
    return base;
  }
  if (DOUBLE[key]) {
    base.layout = 'transform';
    base.type_line = 'Creature \u2014 Test // Creature \u2014 Test';
    base.card_faces = DOUBLE[key].map((n) => ({ object: 'card_face', name: n, type_line: 'Creature \u2014 Test', image_uris: uris(register(n, style)) }));
    return base;
  }
  if (properName.includes(' // ')) {
    base.layout = 'split';
    base.card_faces = properName.split(' // ').map((n) => ({ object: 'card_face', name: n, type_line: 'Instant' }));
  }
  if (/ token$/i.test(properName)) base.layout = 'token';
  base.image_uris = uris(register(properName, style));
  return base;
}

function exactName(name) {
  const key = String(name).toLowerCase().trim();
  if (!key || key.startsWith('missing') || key.startsWith('total:') || TYPO[key]) return null;
  if (key.includes(' // ')) return null;
  if (PART[key]) return PART[key];
  return titleCase(String(name).trim());
}

function fuzzyName(q) {
  if (TYPO[q]) return TYPO[q];
  if (DOUBLE[q]) return DOUBLE[q].join(' // ');
  if (SPLIT[q]) return SPLIT[q].join(' // ');
  return null;
}

/* The live service refuses the whole request when one identifier is malformed. */
function malformed(id) {
  if (id.set != null && (String(id.set).length < 3 || String(id.set).length > 6)) return 'A `set` identifier must be between 3-6 characters: ' + id.set;
  if (id.collector_number != null && (String(id.collector_number).length < 1 || String(id.collector_number).length > 10)) return 'A `collector_number` identifier must be between 1-10 characters: ' + id.collector_number;
  if (id.name != null && !String(id.name).trim()) return 'A `name` identifier must contain text: ';
  if (flags.rejectName && id.name != null && String(id.name).toLowerCase().includes(flags.rejectName)) return 'refused for the test: ' + id.name;
  return null;
}

function findOne(id) {
  if (id.collector_number != null) {
    const set = String(id.set).toLowerCase();
    if (!SETS.includes(set)) return null;
    if (String(id.collector_number) === '999') return makeCard('Wrong Card', { set, cn: '999' });
    const named = pendingNames.get(set + '|' + String(id.collector_number).toLowerCase());
    return named ? makeCard(named, { set, cn: id.collector_number }) : null;
  }
  const proper = exactName(id.name);
  if (!proper) return null;
  if (id.set != null) {
    const set = String(id.set).toLowerCase();
    if (!SETS.includes(set)) return null;
    return makeCard(proper, { set });
  }
  return makeCard(proper);
}

/* The real service knows which card has a given set and number. The mock learns it from the
   test's deck lists instead (see teach()). */
const pendingNames = new Map();
function teach(set, cn, name) { pendingNames.set(String(set).toLowerCase() + '|' + String(cn).toLowerCase(), name); }

const stats = { collection: [], named: [], search: [], decks: [], starter: [], images: 0, preflight: 0 };
const flags = { blockAll: false, cors: 'star', corsImages: null, rateLimitOnce: false, failImage: null, rejectName: null, failDeck: false, smallPools: false, kinPool: null };

function corsHeaders(reqHeaders, extra, forImages) {
  const origin = reqHeaders && (reqHeaders.origin || reqHeaders.Origin);
  const mode = forImages && flags.corsImages ? flags.corsImages : flags.cors;
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, Origin',
    'Access-Control-Max-Age': '300'
  };
  // star: any page may read the answer. echo: repeat the caller's Origin back.
  // web-only: only answer pages served from a web address. none: no cross-site access at all.
  if (mode === 'none') return Object.assign({}, extra);
  if (mode === 'echo') return origin ? Object.assign(base, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }, extra) : Object.assign({}, extra);
  if (mode === 'web-only') return origin && /^https?:\/\//.test(origin) ? Object.assign(base, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }, extra) : Object.assign({}, extra);
  return Object.assign(base, { 'Access-Control-Allow-Origin': '*' }, extra);
}

/* One request in, one answer out. Used by both the in-browser route mock and the local HTTPS server. */
async function answer(method, href, reqHeaders, bodyText) {
  const url = new URL(href);
  const json = (status, body) => ({ status, headers: corsHeaders(reqHeaders, { 'Content-Type': 'application/json; charset=utf-8' }), body: JSON.stringify(body) });
  const pictures = url.hostname === 'cards.scryfall.io';
  if (url.hostname === 'mtgjson.com') {
    const m = /^\/api\/v5\/decks\/([A-Za-z0-9_]+)\.json$/.exec(url.pathname);
    stats.decks.push({ at: Date.now(), file: m ? m[1] : url.pathname });
    if (!m || flags.failDeck) return json(flags.failDeck ? 503 : 404, { error: 'not here' });
    return json(200, mtgjsonDeck(m[1]));
  }
  if (method === 'OPTIONS') { stats.preflight++; return { status: 204, headers: corsHeaders(reqHeaders, {}, pictures), body: '' }; }

  if (pictures) {
    const m = /^\/(small|normal|large|png)\/front\/(.+)\.(jpg|png)$/.exec(url.pathname);
    if (!m) return { status: 404, headers: corsHeaders(reqHeaders, {}, true), body: '' };
    if (flags.failImage && m[1] === 'png' && m[2].includes(flags.failImage)) return { status: 503, headers: corsHeaders(reqHeaders, {}, true), body: '' };
    stats.images++;
    const size = m[1] === 'large' ? 'normal' : m[1];
    return { status: 200, headers: corsHeaders(reqHeaders, { 'Content-Type': size === 'png' ? 'image/png' : 'image/jpeg' }, true), body: await image(m[2], size) };
  }

  if (url.pathname === '/cards/collection' && method === 'POST') {
    if (flags.rateLimitOnce) { flags.rateLimitOnce = false; stats.collection.push({ at: Date.now(), n: 0, limited: true }); return json(429, { object: 'error', code: 'rate_limited', status: 429 }); }
    const body = JSON.parse(bodyText || '{}');
    const idents = body.identifiers || [];
    const refused = idents.map(malformed).find(Boolean);
    stats.collection.push({ at: Date.now(), n: idents.length, refused: !!refused, contentType: reqHeaders['content-type'], accept: reqHeaders.accept, origin: reqHeaders.origin });
    if (idents.length > 75) return json(400, { object: 'error', code: 'bad_request', status: 400 });
    if (refused) return json(400, { object: 'error', code: 'bad_request', status: 400, details: refused });
    const data = [], notFound = [];
    idents.forEach((id) => { const c = findOne(id); if (c) data.push(c); else notFound.push(id); });
    return json(200, { object: 'list', not_found: notFound, data });
  }
  if (url.pathname === '/cards/named') {
    const q = (url.searchParams.get('fuzzy') || '').toLowerCase().trim();
    stats.named.push({ at: Date.now(), q });
    const hit = fuzzyName(q);
    return hit ? json(200, makeCard(hit)) : json(404, { object: 'error', code: 'not_found', status: 404 });
  }
  if (url.pathname === '/cards/search') {
    stats.search.push({ at: Date.now(), q: url.search });
    const query = url.searchParams.get('q') || '';
    if (/\bis:commander\b/.test(query)) {
      const words = (query.match(/name:([a-z0-9]+)/g) || []).map((w) => w.slice(5));
      const hits = COMMANDERS.filter((n) => words.length && words.every((w) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(w)));
      if (!hits.length) return json(404, { object: 'error', code: 'not_found', status: 404 });
      return json(200, { object: 'list', total_cards: hits.length, has_more: false, data: hits.map((n) => Object.assign(makeCard(n, { set: 'cmr', cn: '1' }), { type_line: 'Legendary Creature \u2014 Test Angel', color_identity: ['W', 'U'], oracle_text: /Kaalia/.test(n) ? 'Flying. Whenever this attacks, put an Angel onto the battlefield.' : 'Flying' })) });
    }
    if (/\blegal:commander\b/.test(query)) {
      /* one made-up pool per job, most played first; a few names repeat across jobs on purpose */
      const job = /otag:board-wipe -t:land/.test(query) ? 'Wipe' : /otag:ramp/.test(query) ? 'Ramp' : /otag:draw/.test(query) ? 'Draw' : /otag:removal/.test(query) ? 'Removal'
        : /t:land -t:basic/.test(query) ? 'Land' : /t:creature t:([a-z]+)/.test(query) ? 'Kin' : /-t:creature/.test(query) ? 'Good' : 'Creature';
      const size = flags.smallPools ? 4 : (job === 'Kin' ? (flags.kinPool == null ? 30 : flags.kinPool) : 40);
      const data = [];
      for (let i = 1; i <= size; i++) data.push(makeCard(i === 1 && (job === 'Draw' || job === 'Removal') ? 'Ramp Pick 1' : job + ' Pick ' + i, { set: 'cmr', cn: String(100 + i) }));
      if (job === 'Land') data.unshift(makeCard('Island', { set: 'cmr', cn: '500' }));
      stats.starter.push(query);
      return json(200, { object: 'list', total_cards: data.length, has_more: false, data });
    }
    const m = /oracleid:oracle-([a-z0-9-]+)/.exec(query);
    if (!m) return json(404, { object: 'error', code: 'not_found', status: 404 });
    const dkey = Object.keys(DOUBLE).find((k) => slug(k) === m[1]);
    const name = dkey ? DOUBLE[dkey].join(' // ') : titleCase(m[1].replace(/-/g, ' '));
    const all = [
      makeCard(name, { set: 'tst', cn: '1', released: '2024-01-01' }),
      makeCard(name, { set: 'bdl', cn: '7', released: '2023-06-01' }),
      makeCard(name, { set: 'cmm', cn: '12', released: '2022-02-02', digital: true }),
      makeCard(name, { set: 'wht', cn: '250', released: '1995-04-01' }),
      makeCard(name, { set: 'c21', cn: '99', released: '2021-04-23', noImage: true }),
      makeCard(name, { set: 'znr', cn: '300', released: '2020-09-25' })
    ];
    if (url.searchParams.get('page') !== '2') return json(200, { object: 'list', total_cards: all.length, has_more: true, next_page: href + '&page=2', data: all.slice(0, 3) });
    return json(200, { object: 'list', total_cards: all.length, has_more: false, data: all.slice(3) });
  }
  return json(404, { object: 'error', code: 'not_found', status: 404 });
}

/* Adapter 1: answer inside the browser through Playwright routes (fast, but Playwright smooths over
   cross-site rules, so it cannot show what a browser does when a server refuses them). */
async function install(page) {
  const handler = async (route) => {
    if (flags.blockAll) return route.abort('internetdisconnected');
    const req = route.request();
    const res = await answer(req.method(), req.url(), req.headers(), req.postData());
    return route.fulfill({ status: res.status, headers: res.headers, body: res.body });
  };
  await page.route('https://api.scryfall.com/**', handler);
  await page.route('https://mtgjson.com/**', handler);
  await page.route('https://cards.scryfall.io/**', handler);
}

/* Adapter 2: a real HTTPS server on this machine. Chrome is told to resolve the two Scryfall
   host names to it, so requests take the browser's real network path and its real cross-site checks. */
function serve(https, tls, port) {
  const server = https.createServer(tls, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const out = await answer(req.method, 'https://' + req.headers.host.replace(/:\d+$/, '') + req.url, req.headers, Buffer.concat(chunks).toString('utf8'));
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { install, serve, answer, stats, flags, teach, image, registry, register, makeCard };
