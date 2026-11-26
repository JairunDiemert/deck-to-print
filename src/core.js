/* Deck to Print: core logic. No DOM in this file, so it can be tested on its own. */
(function (root) {
  'use strict';

  /* Deck sizes MakePlayingCards sells for its 63 x 88 mm game cards. */
  var MPC_SIZES = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612];

  /* ---------- names ---------- */

  function normName(s) {
    return String(s == null ? '' : s)
      .replace(/[\u00c6\u00e6]/g, 'ae')
      .replace(/[\u0152\u0153]/g, 'oe')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function sanitizeFileName(name) {
    var s = String(name == null ? '' : name)
      .replace(/[\u00c6\u00e6]/g, 'ae')
      .replace(/[\u0152\u0153]/g, 'oe')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s*\/\/\s*/g, ' - ')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^A-Za-z0-9 ,'&!()._\-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (s.length > 60) s = s.slice(0, 60).trim();
    return s || 'card';
  }

  function pad3(n) {
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return s;
  }

  /* ---------- deck list parsing ---------- */

  var SECTION_PATTERNS = [
    ['commander', /^(commanders?|command zone)$/],
    ['companion', /^companions?$/],
    ['main', /^(deck|main|main ?deck|main ?board|library)$/],
    ['sideboard', /^(side ?board|side|sb)$/],
    ['maybe', /^(maybe ?board|maybe|considering|wish ?list|acquire ?board)$/],
    ['tokens', /^(tokens?|tokens? (and|&) extras|extras)$/],
    ['about', /^about$/]
  ];

  function headerOf(line) {
    var t = String(line)
      .replace(/^[\/#=*\-\s]+/, '')
      .replace(/[\s:\uFF1A=*\-]+$/, '')
      .replace(/\s*[(\[]\s*\d+\s*[)\]]\s*$/, '')
      .replace(/[\s:\uFF1A]+$/, '');
    if (!t || /^\d/.test(t)) return null;
    var n = t.toLowerCase();
    for (var i = 0; i < SECTION_PATTERNS.length; i++) {
      if (SECTION_PATTERNS[i][1].test(n)) return SECTION_PATTERNS[i][0];
    }
    return null;
  }

  var QTY_RE = /^(\d{1,3})\s*[xX]?\s+(.+)$/;

  function startsWithQuantity(line) {
    var t = String(line).replace(/[\u00a0\t]/g, ' ').trim().replace(/^[\-*\u2022]\s+/, '').replace(/^sb:\s*/i, '');
    return QTY_RE.test(t) || /^[xX]\d{1,3}\s+\S/.test(t);
  }

  function parseLine(input) {
    var line = String(input).replace(/[\u00a0\t]/g, ' ').trim();
    line = line.replace(/^[\-*\u2022]\s+/, '');
    var out = { qty: 1, hasQty: false, name: '', set: null, cn: null, maybe: false, side: false };
    var m = line.match(QTY_RE);
    if (m) {
      out.qty = parseInt(m[1], 10);
      out.hasQty = true;
      line = m[2];
    } else if ((m = line.match(/^[xX](\d{1,3})\s+(.+)$/))) {
      out.qty = parseInt(m[1], 10);
      out.hasQty = true;
      line = m[2];
    }

    /* Archidekt colour tags, Moxfield tags, foil markers */
    line = line.replace(/\s*\^[^^]*\^/g, '');
    line = line.replace(/\s+#.*$/, '');
    line = line.replace(/\s+\*[A-Za-z]{1,2}\*(?=\s|$)/g, '');
    line = line.replace(/\s+\((?:foil|etched)\)(?=\s|$)/ig, '');

    /* Square-bracket tags at the end: Archidekt categories, or a set code */
    var bracketSet = null;
    var tag;
    while ((tag = line.match(/\s*\[([^\]]*)\]\s*$/))) {
      /* Archidekt marks cards outside the deck: [Sideboard{noDeck}] and [Maybeboard{noDeck}{noPrice}] */
      if (/^sideboard\b/i.test(tag[1])) out.side = true;
      else if (/maybeboard|\{nodeck\}/i.test(tag[1])) out.maybe = true;
      if (!bracketSet && /^[A-Z0-9]{2,5}$/.test(tag[1])) bracketSet = tag[1];
      line = line.slice(0, tag.index);
    }

    /* "Name (SET) 123" with optional trailing extras.
       Arena exports write empty brackets, "Name () 3", when a set has no Arena code: drop them. */
    m = line.match(/^(.*)\s*\(([A-Za-z0-9_]{0,8})\)(?:\s+(\S+))?(?:\s+.*)?$/);
    if (m && m[1].trim()) {
      line = m[1];
      if (m[2]) {
        out.set = m[2].toLowerCase();
        out.cn = m[3] || null;
      }
    } else if (bracketSet) {
      out.set = bracketSet.toLowerCase();
    }

    out.name = line.replace(/\s+\/\s+/g, ' // ').replace(/\s{2,}/g, ' ').trim();
    return out.name ? out : null;
  }

  /* Deck builders can put a heading above each group of cards: "Commander", "Sideboard", but also
     card types ("Creature") or the owner's own categories ("Ramp", "The Gun"). Card lines in those
     exports always start with a number, so a line with no number that stands at the top of a block
     (first line, or right after a blank line) and is followed by a numbered line is a heading. */
  function parseDeckList(text) {
    var entries = [];
    var headings = [];
    var section = 'main';
    var lines = String(text == null ? '' : text).split(/\r\n|\r|\n/).map(function (raw) {
      return { raw: raw, text: raw.replace(/[ \t]/g, ' ').trim() };
    });
    function nextContent(i) {
      for (var j = i + 1; j < lines.length; j++) if (lines[j].text) return lines[j].text;
      return null;
    }
    function numberedLater(i) {
      for (var j = i + 1; j < lines.length; j++) if (lines[j].text && startsWithQuantity(lines[j].text)) return true;
      return false;
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].text;
      if (!line) {
        if (section === 'about') section = 'main';
        continue;
      }
      if (/^(\/\/|#)/.test(line)) {
        var hs = headerOf(line);
        if (hs) section = hs;
        continue;
      }
      var lineSection = section;
      var sb = line.match(/^sb:\s*/i);
      if (sb) {
        lineSection = 'sideboard';
        line = line.slice(sb[0].length);
      } else {
        var h = headerOf(line);
        if (h) { section = h; continue; }
        if (section === 'about') continue;
        if (!startsWithQuantity(line) && !/^[\-*\u2022]\s+/.test(line)) {
          var topOfBlock = i === 0 || !lines[i - 1].text || entries.length === 0;
          var next = nextContent(i);
          /* also a title on a line of its own, e.g. the deck's name above the whole list */
          var alone = i + 1 >= lines.length || !lines[i + 1].text;
          if (topOfBlock && next && (startsWithQuantity(next) || (alone && numberedLater(i)))) {
            section = 'main';
            headings.push(line);
            continue;
          }
        }
      }
      var p = parseLine(line);
      if (!p || !p.qty) continue;
      if (p.side) lineSection = 'sideboard';
      else if (p.maybe) lineSection = 'maybe';
      entries.push({
        qty: Math.min(p.qty, 250),
        name: p.name,
        set: p.set,
        cn: p.cn,
        section: lineSection,
        lineNo: i + 1,
        raw: lines[i].raw.trim(),
        card: null,
        status: 'pending'
      });
    }
    entries.headings = headings;
    return entries;
  }

  function isIncluded(entry, opts) {
    if (entry.section === 'maybe' || entry.section === 'about') return false;
    if (entry.section === 'sideboard' && !(opts && opts.sideboard)) return false;
    return true;
  }

  /* ---------- Scryfall identifiers ---------- */

  /* Most specific first. Later ones are fallbacks when the earlier one is not found. */
  /* Scryfall's bulk lookup matches "Fire" or "Delver of Secrets" but not the full
     "Fire // Ice" or "Delver of Secrets // Insectile Aberration", so ask by the first part.
     The caller then checks the answer against the full name. */
  function lookupName(name) {
    var n = String(name);
    return n.indexOf(' // ') === -1 ? n : n.split(' // ')[0].trim();
  }

  /* Scryfall rejects a whole request if any one identifier is malformed:
     set codes must be 3 to 6 characters and collector numbers 1 to 10.
     Arena exports use other codes ("UL" for Urza's Legacy), so check before asking. */
  function validSet(s) { return typeof s === 'string' && /^[a-z0-9]{3,6}$/i.test(s); }
  function validNumber(s) { return typeof s === 'string' && s.length >= 1 && s.length <= 10 && !/\s/.test(s); }

  function identChain(entry) {
    var chain = [];
    var name = lookupName(entry.name).slice(0, 200);
    var set = validSet(entry.set) ? entry.set.toLowerCase() : null;
    if (set && validNumber(entry.cn)) chain.push({ set: set, collector_number: entry.cn });
    if (!name) return chain;
    if (set) chain.push({ name: name, set: set });
    chain.push({ name: name });
    return chain;
  }

  function identKey(id) {
    if (id.collector_number != null) return 'c|' + String(id.set).toLowerCase() + '|' + String(id.collector_number).toLowerCase();
    if (id.set != null) return 'ns|' + String(id.name).toLowerCase().trim() + '|' + String(id.set).toLowerCase();
    return 'n|' + String(id.name).toLowerCase().trim();
  }

  function sameIdent(a, b) {
    if (!a || !b) return false;
    var keys = ['name', 'set', 'collector_number', 'id'];
    for (var i = 0; i < keys.length; i++) {
      var x = a[keys[i]], y = b[keys[i]];
      if ((x == null) !== (y == null)) return false;
      if (x != null && String(x).toLowerCase().trim() !== String(y).toLowerCase().trim()) return false;
    }
    return true;
  }

  function cardNames(card) {
    var names = [];
    if (card.name) {
      names.push(card.name);
      String(card.name).split(' // ').forEach(function (p) { names.push(p); });
    }
    (card.card_faces || card.faces || []).forEach(function (f) { if (f && f.name) names.push(f.name); });
    if (card.flavor_name) names.push(card.flavor_name);
    if (card.printed_name) names.push(card.printed_name);
    return names.map(normName);
  }

  function nameMatches(card, name) {
    var n = normName(name);
    if (!n) return false;
    return cardNames(card).indexOf(n) !== -1;
  }

  function editDistance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var best = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* The forgiving search can come back with a card that has nothing to do with what was typed
     (checked live: "Sol Rng" returned a different card entirely). Printing the wrong card without
     saying so is worse than asking the person to fix a typo, so only accept an answer that is the
     same name, the name with a letter or two off, or the name's opening words. */
  function closeEnough(typedName, card) {
    var n = normName(typedName);
    if (!n || !card) return false;
    var names = cardNames(card);
    for (var i = 0; i < names.length; i++) {
      var c = names[i];
      if (c === n) return true;
      if (n.length >= 4 && c.indexOf(n + ' ') === 0) return true;
      var limit = Math.max(1, Math.floor(Math.max(n.length, c.length) * 0.2));
      if (editDistance(n, c, limit) <= limit) return true;
    }
    return false;
  }

  function cardMatchesIdent(card, id) {
    if (id.collector_number != null) {
      return String(card.set).toLowerCase() === String(id.set).toLowerCase() &&
        String(card.collector_number).toLowerCase() === String(id.collector_number).toLowerCase();
    }
    if (id.set != null && String(card.set).toLowerCase() !== String(id.set).toLowerCase()) return false;
    return nameMatches(card, id.name);
  }

  /* Scryfall returns found cards in request order and lists the misses separately.
     Line the answers back up with what we asked for. */
  function alignCollection(idents, data, notFound) {
    var out = [];
    var i, j;
    for (i = 0; i < idents.length; i++) out.push(null);
    data = data || [];
    var nf = (notFound || []).slice();

    if (idents.length - nf.length === data.length) {
      var tmp = out.slice();
      j = 0;
      for (i = 0; i < idents.length; i++) {
        var k = -1;
        for (var q = 0; q < nf.length; q++) { if (sameIdent(nf[q], idents[i])) { k = q; break; } }
        if (k >= 0) { nf.splice(k, 1); continue; }
        tmp[i] = j < data.length ? data[j] : null;
        j++;
      }
      if (j === data.length && nf.length === 0) return tmp;
    }

    j = 0;
    for (i = 0; i < idents.length; i++) {
      if (j < data.length && cardMatchesIdent(data[j], idents[i])) { out[i] = data[j]; j++; }
    }
    return out;
  }

  /* ---------- cards ---------- */

  function okImageUrl(u) {
    return typeof u === 'string' && /^https:\/\/[a-z0-9.\-]+\.scryfall\.io\//i.test(u);
  }

  function okApiUrl(u) {
    return typeof u === 'string' && /^https:\/\/api\.scryfall\.com\//i.test(u);
  }

  function faceFrom(name, uris) {
    if (!uris || !okImageUrl(uris.png)) return null;
    return {
      name: name,
      png: uris.png,
      small: okImageUrl(uris.small) ? uris.small : uris.png,
      normal: okImageUrl(uris.normal) ? uris.normal : uris.png
    };
  }

  /* Keep only what the tool needs from a Scryfall card object. */
  function slimCard(c) {
    var faces = [];
    if (c.image_uris) {
      var f = faceFrom(c.name, c.image_uris);
      if (f) faces.push(f);
    } else if (c.card_faces) {
      c.card_faces.forEach(function (cf) {
        var ff = faceFrom(cf.name, cf.image_uris);
        if (ff) faces.push(ff);
      });
    }
    var type = c.type_line || (c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || '';
    return {
      id: c.id,
      name: c.name,
      set: c.set,
      set_name: c.set_name,
      collector_number: c.collector_number,
      released_at: c.released_at || '',
      layout: c.layout || '',
      type_line: type,
      card_faces: (c.card_faces || []).map(function (cf) { return { name: cf.name }; }),
      prints_search_uri: okApiUrl(c.prints_search_uri) ? c.prints_search_uri : null,
      digital: !!c.digital,
      faces: faces,
      isBasic: /\bBasic\b/.test(type) && /\bLand\b/.test(type)
    };
  }

  /* Asking for "Treasure" can return a promotional token with a different token on each side.
     The person asked for one of them, so keep only the side they named. */
  function narrowToNamedFace(card, wantedName) {
    if (!card || card.layout !== 'double_faced_token' || card.faces.length < 2) return card;
    var n = normName(wantedName);
    var hits = card.faces.filter(function (f) { return normName(f.name) === n; });
    if (hits.length !== 1) return card;
    var copy = {};
    Object.keys(card).forEach(function (k) { copy[k] = card[k]; });
    copy.id = card.id + ':' + n;
    copy.name = hits[0].name;
    copy.faces = [hits[0]];
    copy.layout = 'token';
    copy.prints_search_uri = null;
    return copy;
  }

  /* ---------- pairing fronts and backs ---------- */

  function expand(entries, deckIndex, opts) {
    var list = [];
    (entries || []).forEach(function (e) {
      if (!isIncluded(e, opts)) return;
      if (!e.card || !e.card.faces || !e.card.faces.length) return;
      if (opts && opts.skipBasics && e.card.isBasic) return;
      for (var i = 0; i < e.qty; i++) list.push({ deck: deckIndex, entry: e, card: e.card });
    });
    return list;
  }

  function faceOf(inst, index) {
    var f = inst.card.faces[index];
    return { type: 'card', deck: inst.deck, entry: inst.entry, card: inst.card, faceIndex: index, name: f.name, png: f.png, small: f.small, normal: f.normal };
  }

  var BLANK = { type: 'blank', name: 'plain side' };

  /* Each slot is one physical card.
     Double-faced cards keep both of their own faces, so they go first.
     Then deck 1 fills the fronts and deck 2 fills the backs. A card with no partner gets a plain
     other side, and it stays on its own deck's side: every front is deck 1 and every back is deck 2.
     That way it never matters which back ends up behind which front, except for double-faced cards.
     (If only the second box was filled in, that deck simply goes on the fronts.) */
  function buildSlots(entriesA, entriesB, opts) {
    var a = expand(entriesA, 0, opts), b = expand(entriesB, 1, opts);
    var slots = [];
    var singles = [[], []];
    var doubles = [0, 0];
    [a, b].forEach(function (list, d) {
      list.forEach(function (inst) {
        if (inst.card.faces.length >= 2) {
          slots.push({ front: faceOf(inst, 0), back: faceOf(inst, 1), double: true });
          doubles[d]++;
        } else {
          singles[d].push(inst);
        }
      });
    });
    var onlySecond = a.length === 0 && b.length > 0;
    var n = Math.max(singles[0].length, singles[1].length);
    var blanks = 0, plainBacks = 0;
    for (var i = 0; i < n; i++) {
      var x = singles[0][i], y = singles[1][i];
      if (x && y) slots.push({ front: faceOf(x, 0), back: faceOf(y, 0), double: false });
      else if (x || onlySecond) { slots.push({ front: faceOf(x || y, 0), back: BLANK, double: false }); blanks++; plainBacks++; }
      else { slots.push({ front: BLANK, back: faceOf(y, 0), double: false }); blanks++; }
    }
    return {
      slots: slots,
      counts: [a.length, b.length],
      doubles: doubles,
      singles: [singles[0].length, singles[1].length],
      blanks: blanks,
      sameBack: slots.length > 0 && plainBacks === slots.length
    };
  }

  function mpcSize(n) {
    for (var i = 0; i < MPC_SIZES.length; i++) if (MPC_SIZES[i] >= n) return MPC_SIZES[i];
    return null;
  }

  /* File list for the download. Every name is unique and sorts in slot order. */
  function fileNamesFor(plan) {
    var files = [];
    plan.slots.forEach(function (s, i) {
      var no = pad3(i + 1);
      files.push({ side: 'front', slot: i, face: s.front, name: 'fronts/F' + no + ' ' + sanitizeFileName(s.front.name) + '.jpg' });
      if (!plan.sameBack) {
        files.push({ side: 'back', slot: i, face: s.back, name: 'backs/B' + no + ' ' + sanitizeFileName(s.back.name) + '.jpg' });
      }
    });
    if (plan.sameBack) {
      files.push({ side: 'back', slot: -1, face: BLANK, name: 'backs/B000 card back (same for every card).jpg' });
    }
    return files;
  }

  /* ---------- ordering steps (shown on the page and saved into the download) ---------- */

  var MPC_URL = 'https://www.makeplayingcards.com/design/custom-blank-card.html';

  function orderSteps(plan) {
    var n = plan.slots.length;
    var size = mpcSize(n);
    var dfc = plan.doubles[0] + plan.doubles[1];
    var steps = [];
    steps.push('Unzip the download (on Windows: right-click it and choose Extract All). Inside are a "fronts" folder and a "backs" folder.');
    steps.push('Go to makeplayingcards.com and open "Custom Game Cards (63 x 88mm)": ' + MPC_URL);
    if (size) {
      steps.push('Set "Size of deck" to "Up to ' + size + '". If there is a box for the number of cards, enter ' + n + '. Pick a card stock (S30 and S33 are the usual picks for card games), then start your design.');
    } else {
      steps.push('This is more than the 612 cards one order can hold. Split your lists and make two downloads.');
    }
    steps.push('For the card fronts choose "Different images". Press "Upload images", open the fronts folder, select every file (Ctrl+A, or Cmd+A on a Mac) and upload them. When the upload finishes, press "Help me autofill images". All ' + n + ' card slots should now be filled.');
    steps.push('Go to the next step. You can skip adding text.');
    if (plan.sameBack) {
      steps.push('For the card backs choose "Same image", upload the one file in the backs folder and drag it onto the card.');
    } else {
      steps.push('For the card backs choose "Different images" again. Upload every file in the backs folder the same way, then press "Help me autofill images".');
    }
    if (!plan.sameBack) {
      var two = plan.counts[0] > 0 && plan.counts[1] > 0;
      var check = 'On the preview page, look through your cards.';
      if (dfc) {
        check += dfc === 1
          ? ' The first card is double-faced: its back must be the other face of the same card.'
          : ' The first ' + dfc + ' cards are double-faced: each back must be the other face of the same card.';
        check += ' If one is wrong, drag the right picture onto it. The file names start with the card number, so F001 goes with B001.';
      }
      if (two) {
        check += (dfc ? ' For the other cards' : ' For these cards') + ' it does not matter exactly which back sits behind which front: every front is deck 1 and every back is deck 2.';
      } else if (dfc) {
        check += ' Every other card should have the plain back.';
      }
      steps.push(check);
    }
    steps.push('Add it to your cart and check out.');
    return steps;
  }

  function orderText(plan) {
    var lines = [];
    lines.push('HOW TO ORDER YOUR CARDS');
    lines.push('');
    lines.push('Cards in this download: ' + plan.slots.length);
    var size = mpcSize(plan.slots.length);
    if (size) lines.push('Size of deck to choose: Up to ' + size);
    lines.push('');
    orderSteps(plan).forEach(function (s, i) { lines.push((i + 1) + '. ' + s); lines.push(''); });
    lines.push('The printing site changes its pages from time to time, so button names may differ a little.');
    lines.push('');
    lines.push('These files are for personal playtest cards only. Do not sell them and do not use them in sanctioned events.');
    lines.push('Unofficial fan tool. Not affiliated with or endorsed by Wizards of the Coast, Scryfall or MakePlayingCards.');
    return lines.join('\r\n');
  }

  /* ---------- zip (stored, no compression: the images are already compressed) ---------- */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var bin = unescape(encodeURIComponent(s));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function dosDateTime(d) {
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
      date: (((Math.max(1980, d.getFullYear()) - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  /* files: [{ name, size, crc, data }] where data is a Uint8Array or a Blob.
     Returns the list of parts to hand to new Blob(parts). */
  function zipParts(files, date) {
    var parts = [], central = [], offset = 0;
    var dt = dosDateTime(date || new Date());
    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dt.time, true);
      lh.setUint16(12, dt.date, true);
      lh.setUint32(14, f.crc >>> 0, true);
      lh.setUint32(18, f.size, true);
      lh.setUint32(22, f.size, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameBytes, f.data);

      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dt.time, true);
      ch.setUint16(14, dt.date, true);
      ch.setUint32(16, f.crc >>> 0, true);
      ch.setUint32(20, f.size, true);
      ch.setUint32(24, f.size, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameBytes);
      offset += 30 + nameBytes.length + f.size;
    });
    var cdSize = 0;
    central.forEach(function (p) { cdSize += p.length; });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);
    return parts.concat(central, [new Uint8Array(end.buffer)]);
  }

  /* ---------- hand-off to MPC Autofill (mpcfill.com) ----------
     That site takes one card per line and lets a line name both sides: "front // back".
     Its server only answers its own pages, so this page cannot fetch its pictures directly.
     Instead it writes the paired list for the person to paste there. */

  var MPCFILL_URL = 'https://mpcfill.com';

  function mpcQuery(face) {
    var card = face.card, layout = card.layout || '';
    var name;
    if (card.faces.length >= 2) name = face.name;                                  /* each side of a double-faced card by its own name */
    else if (layout === 'split' || layout === 'aftermath') name = String(card.name); /* both halves share one picture */
    else name = String(card.name).split(' // ')[0];                                /* adventures, flip cards: front name */
    name = name.replace(/\s*\/\/\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();        /* "//" would be read as front and back */
    var token = layout === 'token' || layout === 'double_faced_token' || layout === 'emblem';
    return (token ? 't:' : '') + name;
  }

  function mpcAutofillList(plan) {
    var lines = [];
    plan.slots.forEach(function (s) {
      var f = s.front.type === 'card' ? mpcQuery(s.front) : null;
      var b = s.back.type === 'card' ? mpcQuery(s.back) : null;
      var text = f && b ? f + ' // ' + b : (f || b);
      if (!text) return;
      var last = lines[lines.length - 1];
      if (last && last.text === text) last.qty++;
      else lines.push({ qty: 1, text: text });
    });
    return lines.map(function (l) { return l.qty + 'x ' + l.text; }).join('\n');
  }

  function mpcSteps(plan) {
    var steps = [];
    steps.push('Press "Copy the list" above.');
    steps.push('Open ' + MPCFILL_URL + ' and start a project. Choose "Add Cards", then "Text", paste the list and submit it.');
    steps.push('Each line is one printed card. Where a line has two names with // between them, the first name is the front and the second is the back. Choose the artwork you like for each side.');
    if (plan.blanks) steps.push('Lines with one name get the card back you pick on that site.');
    steps.push('When it looks right, download the project as XML, and download the desktop tool from the same page. Put both in one folder and run the tool: it fetches the pictures and fills in your MakePlayingCards order for you.');
    steps.push('Check the order on MakePlayingCards, then pay.');
    return steps;
  }

  var api = {
    MPC_SIZES: MPC_SIZES,
    MPCFILL_URL: MPCFILL_URL,
    mpcQuery: mpcQuery,
    mpcAutofillList: mpcAutofillList,
    mpcSteps: mpcSteps,
    MPC_URL: MPC_URL,
    BLANK: BLANK,
    normName: normName,
    sanitizeFileName: sanitizeFileName,
    pad3: pad3,
    headerOf: headerOf,
    parseLine: parseLine,
    parseDeckList: parseDeckList,
    isIncluded: isIncluded,
    lookupName: lookupName,
    identChain: identChain,
    identKey: identKey,
    sameIdent: sameIdent,
    nameMatches: nameMatches,
    closeEnough: closeEnough,
    cardMatchesIdent: cardMatchesIdent,
    alignCollection: alignCollection,
    okImageUrl: okImageUrl,
    okApiUrl: okApiUrl,
    slimCard: slimCard,
    narrowToNamedFace: narrowToNamedFace,
    buildSlots: buildSlots,
    mpcSize: mpcSize,
    fileNamesFor: fileNamesFor,
    orderSteps: orderSteps,
    orderText: orderText,
    crc32: crc32,
    utf8: utf8,
    zipParts: zipParts
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DTP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
