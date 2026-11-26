/* Deck to Print: page behaviour. Card data and images come from Scryfall (https://scryfall.com/docs/api). */
(function () {
  'use strict';

  const C = window.DTP;
  const API = 'https://api.scryfall.com';
  const API_GAP = 550;            // ms between API calls. Scryfall asks for 500 ms on the endpoints used here.
  const IMAGE_WORKERS = 3;        // images come from Scryfall's file servers, which have no rate limit. Stay polite anyway.

  /* Print image: 822 x 1122 px is what MakePlayingCards asks for (300 dpi, trim margin included).
     A 63 x 88 mm card at 300 dpi is 745 x 1040 px, which is exactly Scryfall's PNG size,
     so the scan is placed 1:1 with no resampling and the margin around it is filled in. */
  const OUT_W = 822, OUT_H = 1122;
  const CARD_W = 745, CARD_H = 1040;
  const CARD_X = Math.floor((OUT_W - CARD_W) / 2);
  const CARD_Y = Math.floor((OUT_H - CARD_H) / 2);
  const JPEG_QUALITY = 0.95;
  const MARK_TEXT = 'PROXY - NOT FOR SALE';
  const INK = '#231F20';
  const STORE_KEY = 'deck-to-print.v1';
  const ZIP_NAME = 'deck-print-files.zip';

  const EXAMPLE_A = ['1 Sol Ring', '1 Arcane Signet', '1 Command Tower', '1 Delver of Secrets', '1 Lightning Bolt', '1 Counterspell', '2 Island'].join('\n');
  const EXAMPLE_B = ['1 Llanowar Elves', '1 Cultivate', '1 Rampant Growth', '1 Swords to Plowshares', '1 Birds of Paradise', '2 Forest'].join('\n');

  const $ = (id) => document.getElementById(id);
  const els = {};
  ['deckA', 'deckB', 'optMark', 'optSideboard', 'optBasics', 'find', 'example', 'clear', 'status', 'checkEmpty', 'checkBody',
    'tally', 'tallyNotes', 'orderSize', 'problems', 'proofLead', 'proofHint', 'proof', 'printEmpty', 'printBody', 'download', 'again', 'meter',
    'meterFill', 'dlStatus', 'order', 'picker', 'pickerTitle', 'pickerClose', 'prints', 'pickerStatus', 'pickerMore',
    'srcScryfall', 'srcMpc', 'printTitle', 'printScryfall', 'printMpc', 'copyList', 'copyStatus', 'mpcList', 'mpcOrder'
  ].forEach((id) => { els[id] = $(id); });

  const state = {
    decks: [[], []],        // parsed entries for deck 1 and deck 2
    plan: null,             // slots: one per printed card
    overrides: new Map(),   // artwork the person picked, kept across "Find my cards"
    busy: false,
    zipUrl: null
  };
  const cardCache = new Map();    // identifier -> card, so a second run asks Scryfall for nothing it already has
  const fuzzyCache = new Map();
  const faceCache = new Map();    // prepared print images
  let picker = null;

  /* ---------- small helpers ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function setStatus(target, text, kind) {
    target.textContent = text || '';
    target.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function fail(kind, extra) {
    const e = new Error(kind);
    e.kind = kind;
    Object.assign(e, extra || {});
    return e;
  }

  function failureMessage(e) {
    if (e && e.kind === 'network') {
      return 'Could not reach the card database (Scryfall). Check your internet connection and try again. If you are looking at this page inside an app preview, download the file and open it in Chrome, Edge or Firefox on a computer.' +
        (location.protocol === 'file:' ? ' If your connection is fine, the card database may be refusing pages opened straight from a file: open this page from a web address instead.' : '');
    }
    if (e && e.kind === 'api') return 'The card database returned an error (' + e.status + '). Wait a minute and try again.';
    if (e && e.kind === 'image') {
      return 'Could not download the picture for ' + e.cardName + '. Check your connection and press Download print files again. Cards that are already prepared are kept.' +
        (location.protocol === 'file:' ? ' If it keeps failing on the first picture, the picture server may be refusing pages opened straight from a file: open this page from a web address instead.' : '');
    }
    if (e && e.kind === 'encode') return 'This browser could not prepare the images. Try Chrome, Edge or Firefox on a computer.';
    return 'Something went wrong. Try again.';
  }

  function setBusy(on) {
    state.busy = on;
    els.find.disabled = on;
    els.example.disabled = on;
    els.clear.disabled = on;
    els.download.disabled = on || !(state.plan && state.plan.slots.length);
  }

  function readOptions() {
    return { mark: els.optMark.checked, sideboard: els.optSideboard.checked, skipBasics: els.optBasics.checked, source: els.srcMpc.checked ? 'mpc' : 'scryfall' };
  }

  /* ---------- remember what was typed (this browser only) ---------- */

  function saveDraft() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ a: els.deckA.value, b: els.deckB.value, o: readOptions() }));
    } catch (e) { /* storage can be unavailable; the page works without it */ }
  }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!d) return;
      if (typeof d.a === 'string') els.deckA.value = d.a;
      if (typeof d.b === 'string') els.deckB.value = d.b;
      if (d.o) {
        els.optMark.checked = d.o.mark !== false;
        els.optSideboard.checked = d.o.sideboard !== false;
        els.optBasics.checked = !!d.o.skipBasics;
        els.srcMpc.checked = d.o.source === 'mpc';
        els.srcScryfall.checked = d.o.source !== 'mpc';
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- Scryfall ---------- */

  let apiChain = Promise.resolve();
  let lastApi = 0;

  /* All API calls go through one queue, spaced out as Scryfall asks. */
  function apiFetch(url, init, statusTarget) {
    const run = async () => {
      let drops = 0;
      for (let attempt = 0; ; attempt++) {
        const wait = lastApi + API_GAP - Date.now();
        if (wait > 0) await sleep(wait);
        lastApi = Date.now();
        let res;
        try {
          res = await fetch(url, Object.assign({ mode: 'cors', credentials: 'omit' }, init, {
            headers: Object.assign({ Accept: 'application/json' }, init && init.headers)
          }));
        } catch (e) {
          /* A dropped connection is often a blip. Try twice more before saying so. */
          if (++drops > 2) throw fail('network');
          await sleep(1200 * drops);
          continue;
        }
        lastApi = Date.now();
        if (res.status === 429 && attempt < 2) {
          if (statusTarget) setStatus(statusTarget, 'The card database asked us to slow down. Waiting 30 seconds, then carrying on.', 'busy');
          await sleep(31000);
          continue;
        }
        return res;
      }
    };
    const p = apiChain.then(run, run);
    apiChain = p.catch(() => {});
    return p;
  }

  async function fetchCollection(idents) {
    const res = await apiFetch(API + '/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: idents })
    }, els.status);
    if (res.status === 400) {
      /* One identifier Scryfall does not accept fails the whole request. Narrow it down by halves
         so a single odd line cannot take the rest of the deck with it. */
      if (idents.length === 1) return [null];
      const mid = Math.ceil(idents.length / 2);
      const left = await fetchCollection(idents.slice(0, mid));
      const right = await fetchCollection(idents.slice(mid));
      return left.concat(right);
    }
    if (!res.ok) throw fail('api', { status: res.status });
    const body = await res.json();
    return C.alignCollection(idents, body.data || [], body.not_found || []);
  }

  async function fetchFuzzy(name) {
    const res = await apiFetch(API + '/cards/named?fuzzy=' + encodeURIComponent(name), null, els.status);
    if (res.status === 404) return null;
    if (!res.ok) throw fail('api', { status: res.status });
    return res.json();
  }

  async function resolveEntries(entries) {
    const todo = entries.filter((e) => !e.card);
    todo.forEach((e) => { e.chain = C.identChain(e); });

    for (let level = 0; level < 3; level++) {
      const pending = todo.filter((e) => !e.card && e.chain[level]);
      if (!pending.length) continue;
      const need = new Map();
      pending.forEach((e) => {
        const k = C.identKey(e.chain[level]);
        if (!cardCache.has(k)) need.set(k, e.chain[level]);
      });
      const list = Array.from(need.values());
      for (let i = 0; i < list.length; i += 75) {
        const chunk = list.slice(i, i + 75);
        setStatus(els.status, 'Looking up your cards (' + Math.min(i + 75, list.length) + ' of ' + list.length + ')', 'busy');
        const found = await fetchCollection(chunk);
        chunk.forEach((id, n) => cardCache.set(C.identKey(id), found[n] ? C.slimCard(found[n]) : null));
      }
      pending.forEach((e) => {
        const id = e.chain[level];
        const c = cardCache.get(C.identKey(id));
        if (!c) return;
        /* A set and number that point at a different card than the name on the line: trust the name.
           Two-part names are looked up by their first part, so check those answers too. */
        if ((id.collector_number != null || e.name.indexOf(' // ') !== -1) && !C.nameMatches(c, e.name)) return;
        e.card = c;
      });
    }

    /* Last resort: Scryfall's forgiving name search, one card at a time. Catches typos and short names. */
    const left = todo.filter((e) => !e.card);
    const asks = new Map();
    left.forEach((e) => {
      const n = C.normName(e.name);
      if (n && !fuzzyCache.has(n) && !asks.has(n)) asks.set(n, e.name);
    });
    const names = Array.from(asks.entries()).slice(0, 40);
    for (let i = 0; i < names.length; i++) {
      setStatus(els.status, 'Double-checking a few names (' + (i + 1) + ' of ' + names.length + ')', 'busy');
      const card = await fetchFuzzy(names[i][1]);
      const slim = card ? C.slimCard(card) : null;
      /* Only take an answer that really is the card that was typed. See closeEnough. */
      fuzzyCache.set(names[i][0], slim && C.closeEnough(names[i][1], slim) ? slim : null);
    }
    left.forEach((e) => {
      const c = fuzzyCache.get(C.normName(e.name));
      if (c) e.card = c;
    });

    entries.forEach((e) => {
      delete e.chain;
      if (e.card) e.card = C.narrowToNamedFace(e.card, e.name);
      e.status = !e.card ? 'notfound' : (e.card.faces.length ? 'ok' : 'noimage');
    });
  }

  /* ---------- find my cards ---------- */

  function overrideKey(deckIndex, entry) { return deckIndex + '|' + C.normName(entry.name) + '|' + entry.occ; }

  function numberOccurrences(entries) {
    const seen = new Map();
    entries.forEach((e) => {
      const n = C.normName(e.name);
      e.occ = seen.get(n) || 0;
      seen.set(n, e.occ + 1);
    });
  }

  async function findCards() {
    if (state.busy) return;
    saveDraft();
    const decks = [C.parseDeckList(els.deckA.value), C.parseDeckList(els.deckB.value)];
    if (!decks[0].length && !decks[1].length) {
      setStatus(els.status, 'Paste a deck list into the first box, then press Find my cards.', 'bad');
      els.deckA.focus();
      return;
    }
    const opts = readOptions();
    setBusy(true);
    setStatus(els.status, 'Looking up your cards', 'busy');
    try {
      decks.forEach(numberOccurrences);
      const wanted = decks[0].concat(decks[1]).filter((e) => C.isIncluded(e, opts));
      await resolveEntries(wanted);
      decks.forEach((d, di) => d.forEach((e) => {
        const o = state.overrides.get(overrideKey(di, e));
        if (o && e.card) e.card = o;
      }));
      state.decks = decks;
      state.plan = C.buildSlots(decks[0], decks[1], opts);
      resetDownload();
      render();
      const n = state.plan.slots.length;
      setStatus(els.status, n ? 'Found your cards. Check them below.' : 'None of those lines matched a card. Check the spelling and try again.', n ? '' : 'bad');
      setBusy(false);
      if (n) $('step-check').scrollIntoView({ block: 'start' });
    } catch (e) {
      setStatus(els.status, failureMessage(e), 'bad');
      setBusy(false);
    }
  }

  function replan() {
    if (!state.decks[0].length && !state.decks[1].length) return;
    state.plan = C.buildSlots(state.decks[0], state.decks[1], readOptions());
    resetDownload();
    render();
  }

  /* ---------- step 2: show the plan ---------- */

  function render() {
    const plan = state.plan;
    const has = !!(plan && (plan.slots.length || problemEntries().length));
    els.checkEmpty.hidden = has;
    els.checkBody.hidden = !has;
    const canPrint = !!(plan && plan.slots.length);
    els.printEmpty.hidden = canPrint;
    els.printBody.hidden = !canPrint;
    els.download.disabled = state.busy || !canPrint;
    if (!has) return;

    const n = plan.slots.length;
    const two = plan.counts[0] > 0 && plan.counts[1] > 0;
    const mpc = readOptions().source === 'mpc';
    els.tally.textContent = plural(n, 'card', 'cards') + ' to print';
    els.printTitle.textContent = mpc ? 'Copy the list and order' : 'Download and order';
    els.printMpc.hidden = !mpc;
    els.printScryfall.hidden = mpc;
    els.proofHint.textContent = mpc ? 'These pictures only show the pairing. You choose the artwork on MPC Autofill.' : 'Select a card to change its artwork.';

    els.tallyNotes.textContent = '';
    const note = (text, keyClass) => {
      const li = el('li');
      if (keyClass) li.appendChild(el('span', { class: 'key' + (keyClass === 'b' ? ' b' : ''), 'aria-hidden': 'true' }));
      li.appendChild(document.createTextNode(text));
      els.tallyNotes.appendChild(li);
    };
    if (plan.counts[0]) note('Deck 1: ' + plural(plan.counts[0], 'card', 'cards'), 'a');
    if (plan.counts[1]) note('Deck 2: ' + plural(plan.counts[1], 'card', 'cards'), 'b');
    const dfc = plan.doubles[0] + plan.doubles[1];
    if (dfc && two) {
      note(dfc === 1
        ? '1 double-faced card needs both sides of its own card, so it comes first and is not shared with the other deck.'
        : dfc + ' double-faced cards need both sides of their own card, so they come first and are not shared with the other deck.');
    } else if (dfc) {
      note(dfc === 1 ? '1 double-faced card comes first, with its other face on the back.' : dfc + ' double-faced cards come first, each with its other face on the back.');
    }
    if (plan.blanks && two) {
      note(plan.blanks === 1
        ? '1 card has no partner from the other deck, so its other side is plain.'
        : plan.blanks + ' cards have no partner from the other deck, so their other side is plain.');
    } else if (plan.blanks) {
      note(mpc ? 'Every card gets the card back you choose on MPC Autofill. Add a second deck above to put those backs to use.'
        : 'Every card gets a plain back marked as a proxy. Add a second deck above to put those backs to use.');
    }
    state.decks.forEach((d, di) => {
      const hs = d.headings || [];
      if (!hs.length) return;
      const shown = hs.slice(0, 10).join(', ') + (hs.length > 10 ? ' and ' + (hs.length - 10) + ' more' : '');
      note('Deck ' + (di + 1) + ': ' + (hs.length === 1 ? 'this line was read as a heading, not a card: ' : 'these lines were read as headings, not cards: ') + shown + '.');
    });

    els.orderSize.textContent = '';
    if (n) {
      const size = C.mpcSize(n);
      if (size) {
        els.orderSize.appendChild(document.createTextNode('When you order, choose size of deck '));
        els.orderSize.appendChild(el('mark', null, 'Up to ' + size));
        const spare = size - n;
        els.orderSize.appendChild(document.createTextNode(spare === 0
          ? '. That fills it exactly.'
          : '. That leaves ' + plural(spare, 'spare slot', 'spare slots') + ' at the same price, so you can add ' + (spare === 1 ? 'one more card' : 'up to ' + spare + ' more cards') + ' to your lists if you like.'));
      } else {
        els.orderSize.appendChild(el('mark', null, 'More than 612 cards'));
        els.orderSize.appendChild(document.createTextNode(' will not fit in one order. Split your lists and make two downloads.'));
      }
    }

    renderProblems();
    renderProof();
    renderOrder();
    renderMpc();
  }

  function renderMpc() {
    els.mpcList.value = C.mpcAutofillList(state.plan);
    els.mpcOrder.textContent = '';
    C.mpcSteps(state.plan).forEach((text) => {
      const li = el('li');
      const at = text.indexOf(C.MPCFILL_URL);
      if (at === -1) {
        li.textContent = text;
      } else {
        li.appendChild(document.createTextNode(text.slice(0, at)));
        li.appendChild(el('a', { href: C.MPCFILL_URL, target: '_blank', rel: 'noopener noreferrer' }, 'mpcfill.com'));
        li.appendChild(document.createTextNode(text.slice(at + C.MPCFILL_URL.length)));
      }
      els.mpcOrder.appendChild(li);
    });
    setStatus(els.copyStatus, '', '');
  }

  async function copyList() {
    const text = els.mpcList.value;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      els.mpcList.focus();
      els.mpcList.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    }
    setStatus(els.copyStatus, ok ? 'Copied. Now paste it into MPC Autofill.' : 'Could not copy by itself. The list is selected: press Ctrl+C (Cmd+C on a Mac).', ok ? '' : 'bad');
  }

  function problemEntries() {
    const opts = readOptions();
    const out = [];
    state.decks.forEach((d, di) => d.forEach((e) => {
      if (!C.isIncluded(e, opts)) return;
      if (e.status === 'notfound' || e.status === 'noimage') out.push({ deck: di, entry: e });
    }));
    return out;
  }

  function renderProblems() {
    const list = problemEntries();
    els.problems.textContent = '';
    els.problems.hidden = !list.length;
    if (!list.length) return;
    els.problems.appendChild(el('h3', null, list.length === 1 ? '1 line needs a look' : list.length + ' lines need a look'));
    const ul = el('ul');
    list.forEach((p) => {
      const li = el('li');
      li.appendChild(document.createTextNode('Deck ' + (p.deck + 1) + ', line ' + p.entry.lineNo + ': '));
      li.appendChild(el('q', null, p.entry.raw.length > 80 ? p.entry.raw.slice(0, 80) + '...' : p.entry.raw));
      li.appendChild(document.createTextNode(p.entry.status === 'noimage' ? ' has no picture to print yet.' : ' was not found.'));
      ul.appendChild(li);
    });
    els.problems.appendChild(ul);
    els.problems.appendChild(el('p', null, 'These are left out for now. Fix the spelling in the box above and press Find my cards again.'));
  }

  function faceNode(face, slotIndex, side) {
    if (face.type === 'blank') {
      const d = el('div', { class: 'face blank' });
      d.appendChild(el('span', { class: 'blank-art', 'aria-hidden': 'true' }, 'PROXY'));
      d.appendChild(el('span', { class: 'cap' }, 'Plain side'));
      return d;
    }
    const b = el('button', {
      type: 'button',
      class: 'face deck-' + (face.deck === 0 ? 'a' : 'b'),
      'data-slot': slotIndex,
      'data-side': side,
      'aria-label': (side === 'front' ? 'Front: ' : 'Back: ') + face.name + ', from deck ' + (face.deck + 1) + '. Change artwork.'
    });
    b.appendChild(el('img', { src: face.small, alt: '', loading: 'lazy', decoding: 'async', width: 146, height: 204, referrerpolicy: 'no-referrer' }));
    b.appendChild(el('span', { class: 'cap', title: face.name }, face.name));
    return b;
  }

  function renderProof() {
    const single = state.plan.sameBack;
    els.proof.className = 'proof' + (single ? ' is-single' : '') + (readOptions().source === 'mpc' ? ' is-fixed' : '');
    els.proofLead.textContent = '';
    els.proofLead.appendChild(el('b', null, single ? 'Each numbered picture is one printed card.' : 'Each numbered pair is one printed card.'));
    els.proofLead.appendChild(document.createTextNode(single
      ? (readOptions().source === 'mpc' ? ' They all get the same card back.' : ' They all get the same plain back.')
      : ' Front on the left, back on the right.'));
    const frag = document.createDocumentFragment();
    state.plan.slots.forEach((slot, i) => {
      const li = el('li', { class: 'slot' });
      const no = el('div', { class: 'slot-no' }, C.pad3(i + 1));
      if (slot.double) no.appendChild(el('em', null, 'double-faced'));
      li.appendChild(no);
      const pair = el('div', { class: 'pair' });
      pair.appendChild(faceNode(slot.front, i, 'front'));
      if (!single) pair.appendChild(faceNode(slot.back, i, 'back'));
      li.appendChild(pair);
      frag.appendChild(li);
    });
    els.proof.textContent = '';
    els.proof.appendChild(frag);
  }

  function renderOrder() {
    els.order.textContent = '';
    C.orderSteps(state.plan).forEach((text) => {
      const li = el('li');
      const at = text.indexOf(C.MPC_URL);
      if (at === -1) {
        li.textContent = text;
      } else {
        li.appendChild(document.createTextNode(text.slice(0, at)));
        li.appendChild(el('a', { href: C.MPC_URL, target: '_blank', rel: 'noopener noreferrer' }, 'makeplayingcards.com/design/custom-blank-card.html'));
        li.appendChild(document.createTextNode(text.slice(at + C.MPC_URL.length)));
      }
      els.order.appendChild(li);
    });
  }

  /* ---------- artwork picker ---------- */

  function openPicker(face) {
    if (state.busy || !face || face.type !== 'card' || readOptions().source === 'mpc') return;
    const entry = face.entry;
    if (!entry.card.prints_search_uri) return;
    picker = { entry: entry, deck: face.deck, next: entry.card.prints_search_uri, shown: 0 };
    els.pickerTitle.textContent = 'Choose artwork for ' + entry.card.name;
    els.prints.textContent = '';
    els.pickerMore.hidden = true;
    setStatus(els.pickerStatus, '', '');
    if (typeof els.picker.showModal === 'function') els.picker.showModal(); else els.picker.setAttribute('open', '');
    loadPrints();
  }

  function closePicker() {
    picker = null;
    if (els.picker.open && typeof els.picker.close === 'function') els.picker.close(); else els.picker.removeAttribute('open');
  }

  async function loadPrints() {
    const ps = picker;
    if (!ps || !ps.next) return;
    const url = ps.next;
    ps.next = null;
    els.pickerMore.hidden = true;
    setStatus(els.pickerStatus, 'Loading versions', 'busy');
    try {
      const res = await apiFetch(url, null, els.pickerStatus);
      if (picker !== ps) return;
      if (!res.ok && res.status !== 404) throw fail('api', { status: res.status });
      const body = res.ok ? await res.json() : { data: [] };
      if (picker !== ps) return;
      (body.data || []).forEach((raw) => {
        const c = C.slimCard(raw);
        if (!c.faces.length || c.digital) return;
        const li = el('li');
        const b = el('button', { type: 'button', class: 'print' + (c.id === ps.entry.card.id ? ' is-current' : '') });
        b.appendChild(el('img', { src: c.faces[0].normal, alt: '', loading: 'lazy', decoding: 'async', width: 488, height: 680, referrerpolicy: 'no-referrer' }));
        const cap = el('span');
        cap.appendChild(el('b', null, c.set_name || String(c.set || '').toUpperCase()));
        cap.appendChild(document.createTextNode((c.released_at ? c.released_at.slice(0, 4) + ', ' : '') + 'number ' + c.collector_number + (c.id === ps.entry.card.id ? ' (current)' : '')));
        b.appendChild(cap);
        b.addEventListener('click', () => choosePrint(c));
        li.appendChild(b);
        els.prints.appendChild(li);
        ps.shown++;
      });
      ps.next = body.has_more && C.okApiUrl(body.next_page) ? body.next_page : null;
      els.pickerMore.hidden = !ps.next;
      setStatus(els.pickerStatus, ps.shown ? '' : 'No other printed versions with a picture.', '');
    } catch (e) {
      if (picker !== ps) return;
      ps.next = url;
      els.pickerMore.hidden = false;
      setStatus(els.pickerStatus, 'Could not load the versions. Check your connection, then press Show more versions.', 'bad');
    }
  }

  function choosePrint(card) {
    const ps = picker;
    if (!ps) return;
    ps.entry.card = card;
    ps.entry.status = 'ok';
    state.overrides.set(overrideKey(ps.deck, ps.entry), card);
    closePicker();
    replan();
  }

  /* ---------- step 3: build the print images ---------- */

  async function loadBitmap(url, name) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        return await createImageBitmap(blob);
      } catch (e) {
        last = e;
        await sleep(700 * (attempt + 1));
      }
    }
    throw fail('image', { cardName: name, cause: last });
  }

  /* Look at a thin band just inside each edge of the card. If all four are the same flat colour
     the card has a plain border, and the margin can simply continue that colour. */
  function analyseEdges(ctx, x, y, w, h) {
    const bx = x + Math.round(w * 0.14), bw = Math.round(w * 0.72);
    const by = y + Math.round(h * 0.14), bh = Math.round(h * 0.72);
    const bands = [[bx, y + 4, bw, 5], [bx, y + h - 9, bw, 5], [x + 4, by, 5, bh], [x + w - 9, by, 5, bh]];
    const means = [];
    let maxStd = 0;
    bands.forEach((b) => {
      const d = ctx.getImageData(b[0], b[1], b[2], b[3]).data;
      const s = [0, 0, 0], q = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < d.length; i += 12) {
        if (d[i + 3] < 250) continue;
        n++;
        for (let c = 0; c < 3; c++) { s[c] += d[i + c]; q[c] += d[i + c] * d[i + c]; }
      }
      if (!n) return;
      const m = s.map((v) => v / n);
      for (let c = 0; c < 3; c++) maxStd = Math.max(maxStd, Math.sqrt(Math.max(0, q[c] / n - m[c] * m[c])));
      means.push(m);
    });
    if (!means.length) return { uniform: true, css: '#000' };
    const avg = [0, 1, 2].map((c) => means.reduce((a, m) => a + m[c], 0) / means.length);
    let spread = 0;
    means.forEach((m) => { for (let c = 0; c < 3; c++) spread = Math.max(spread, Math.abs(m[c] - avg[c])); });
    return {
      uniform: maxStd < 16 && spread < 22,
      css: 'rgb(' + avg.map((v) => Math.round(v)).join(',') + ')'
    };
  }

  /* For cards whose art runs to the edge: fold each edge outwards like a mirror, so the margin continues the picture. */
  function mirrorEdges(ctx, bmp, x, y, w, h) {
    const sx = bmp.width / w, sy = bmp.height / h;
    const L = x, R = OUT_W - (x + w), T = y, B = OUT_H - (y + h);
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
    ctx.drawImage(bmp, 0, 0, L * sx, bmp.height, 0, 0, L, h); ctx.restore();
    ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1);
    ctx.drawImage(bmp, bmp.width - R * sx, 0, R * sx, bmp.height, -R, 0, R, h); ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.scale(1, -1);
    ctx.drawImage(bmp, 0, 0, bmp.width, T * sy, 0, 0, w, T); ctx.restore();
    ctx.save(); ctx.translate(x, y + h); ctx.scale(1, -1);
    ctx.drawImage(bmp, 0, bmp.height - B * sy, bmp.width, B * sy, 0, -B, w, B); ctx.restore();
  }

  /* Small type running down the right-hand border, where card frames are plain.
     It does not cover the artist or copyright line. */
  function drawMark(ctx, x, y, w, h) {
    const size = 13, track = 1.5;
    ctx.save();
    ctx.font = '700 ' + size + 'px Archivo, Arial, Helvetica, sans-serif';
    const widths = [];
    let total = 0;
    for (let i = 0; i < MARK_TEXT.length; i++) {
      const cw = ctx.measureText(MARK_TEXT[i]).width;
      widths.push(cw);
      total += cw + track;
    }
    total -= track;
    const cx = x + w - 15, cy = y + Math.round(h / 2);
    const d = ctx.getImageData(cx - 6, Math.round(cy - total / 2), 12, Math.max(1, Math.round(total))).data;
    let lum = 0, n = 0;
    for (let p = 0; p < d.length; p += 16) { lum += 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]; n++; }
    const onDark = lum / Math.max(1, n) < 128;
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = onDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
    ctx.fillStyle = onDark ? 'rgba(236,236,236,0.96)' : 'rgba(28,28,28,0.96)';
    for (let pass = 0; pass < 2; pass++) {
      let px = -total / 2;
      for (let i = 0; i < MARK_TEXT.length; i++) {
        if (pass === 0) ctx.strokeText(MARK_TEXT[i], px, 1);
        else ctx.fillText(MARK_TEXT[i], px, 1);
        px += widths[i] + track;
      }
    }
    ctx.restore();
  }

  function newCanvas() {
    const cv = document.createElement('canvas');
    cv.width = OUT_W;
    cv.height = OUT_H;
    return cv;
  }

  function composeFace(bmp, opts) {
    const cv = newCanvas();
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const sc = Math.min(CARD_W / bmp.width, CARD_H / bmp.height);
    const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
    const x = CARD_X + Math.round((CARD_W - w) / 2), y = CARD_Y + Math.round((CARD_H - h) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, x, y, w, h);
    const edge = analyseEdges(ctx, x, y, w, h);
    /* Everything from here is painted underneath the card. */
    ctx.globalCompositeOperation = 'destination-over';
    if (!edge.uniform) {
      mirrorEdges(ctx, bmp, x, y, w, h);
      /* Under the scan's see-through rounded corners: the same picture a touch larger, so the art carries on. */
      const gx = Math.round(w * 0.0175), gy = Math.round(h * 0.0175);
      ctx.drawImage(bmp, x - gx, y - gy, w + 2 * gx, h + 2 * gy);
      /* And further out, where nothing else reaches: the picture stretched over the whole image. */
      ctx.drawImage(bmp, 0, 0, OUT_W, OUT_H);
    }
    ctx.fillStyle = edge.css;
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    ctx.globalCompositeOperation = 'source-over';
    if (opts.mark) drawMark(ctx, x, y, w, h);
    cv.info = { plainBorder: edge.uniform, fill: edge.css, scanWidth: bmp.width, scanHeight: bmp.height, placedAt: [x, y, w, h] };
    return cv;
  }

  /* The plain back: an original design that cannot be mistaken for a real card back. */
  function composeBlank() {
    const cv = newCanvas();
    const ctx = cv.getContext('2d');
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    const ix = CARD_X + 46, iy = CARD_Y + 46, iw = CARD_W - 92, ih = CARD_H - 92, r = 26;
    ctx.strokeStyle = '#6B6869';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ix + r, iy);
    ctx.arcTo(ix + iw, iy, ix + iw, iy + ih, r);
    ctx.arcTo(ix + iw, iy + ih, ix, iy + ih, r);
    ctx.arcTo(ix, iy + ih, ix, iy, r);
    ctx.arcTo(ix, iy, ix + iw, iy, r);
    ctx.closePath();
    ctx.stroke();
    const mx = OUT_W / 2, my = OUT_H / 2;
    ctx.strokeStyle = '#E6E9EC';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(mx, my - 120, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - 52, my - 120); ctx.lineTo(mx + 52, my - 120); ctx.moveTo(mx, my - 172); ctx.lineTo(mx, my - 68); ctx.stroke();
    ctx.fillStyle = '#E6E9EC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 104px Archivo, Arial, Helvetica, sans-serif';
    ctx.fillText('PROXY', mx, my + 40);
    ctx.font = '600 32px Archivo, Arial, Helvetica, sans-serif';
    ctx.fillText('NOT FOR SALE', mx, my + 96);
    return cv;
  }

  /* A canvas JPEG carries no print size. Write 300 dpi into its header so the file opens at card size. */
  function stampDpi(bytes, dpi) {
    const jfif = bytes.length > 18 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF && bytes[3] === 0xE0 &&
      bytes[6] === 0x4A && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0;
    if (!jfif) return false;
    bytes[13] = 1;
    bytes[14] = dpi >> 8; bytes[15] = dpi & 255;
    bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
    return true;
  }

  function faceKey(face, opts) {
    return face.type === 'blank' ? 'blank' : face.png + (opts.mark ? '|mark' : '|plain');
  }

  async function renderFace(face, opts) {
    let cv;
    if (face.type === 'blank') {
      cv = composeBlank();
    } else {
      const bmp = await loadBitmap(face.png, face.name);
      try { cv = composeFace(bmp, opts); } finally { if (bmp.close) bmp.close(); }
    }
    const blob = await new Promise((resolve, reject) => {
      cv.toBlob((b) => (b ? resolve(b) : reject(fail('encode'))), 'image/jpeg', JPEG_QUALITY);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = cv.info || null;
    cv.width = cv.height = 0;
    stampDpi(bytes, 300);
    return { blob: new Blob([bytes], { type: 'image/jpeg' }), size: bytes.length, crc: C.crc32(bytes), info: info };
  }

  async function pool(items, size, worker) {
    let next = 0, failed = null;
    const run = async () => {
      while (!failed && next < items.length) {
        const item = items[next++];
        try { await worker(item); } catch (e) { failed = failed || e; }
      }
    };
    const runners = [];
    for (let i = 0; i < Math.min(size, items.length); i++) runners.push(run());
    await Promise.all(runners);
    if (failed) throw failed;
  }

  function resetDownload() {
    if (state.zipUrl) { URL.revokeObjectURL(state.zipUrl); state.zipUrl = null; }
    els.again.hidden = true;
    els.again.removeAttribute('href');
    els.meter.hidden = true;
    setStatus(els.dlStatus, '', '');
  }

  function megabytes(n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'; }

  async function downloadFiles() {
    const plan = state.plan;
    if (state.busy || !plan || !plan.slots.length) return;
    const opts = readOptions();
    setBusy(true);
    resetDownload();
    els.meter.hidden = false;
    els.meterFill.style.width = '0%';
    try {
      if (document.fonts && document.fonts.load) {
        try { await Promise.all([document.fonts.load('700 13px Archivo'), document.fonts.load('800 104px Archivo')]); } catch (e) { /* falls back to Arial */ }
      }
      if (faceCache.size > 900) faceCache.clear();
      const files = C.fileNamesFor(plan);
      const jobs = new Map();
      files.forEach((f) => {
        const k = faceKey(f.face, opts);
        if (!faceCache.has(k) && !jobs.has(k)) jobs.set(k, f.face);
      });
      const list = Array.from(jobs.entries());
      let done = 0;
      const tick = () => {
        els.meterFill.style.width = (list.length ? Math.round((done / list.length) * 100) : 100) + '%';
        setStatus(els.dlStatus, list.length ? 'Preparing pictures: ' + done + ' of ' + list.length : 'Packing your files', 'busy');
      };
      tick();
      await pool(list, IMAGE_WORKERS, async (job) => {
        faceCache.set(job[0], await renderFace(job[1], opts));
        done++;
        tick();
      });
      els.meterFill.style.width = '100%';
      setStatus(els.dlStatus, 'Packing your files', 'busy');
      await sleep(30);

      let total = 0;
      const zipFiles = files.map((f) => {
        const o = faceCache.get(faceKey(f.face, opts));
        total += o.size;
        return { name: f.name, size: o.size, crc: o.crc, data: o.blob };
      });
      const txt = C.utf8(C.orderText(plan));
      zipFiles.push({ name: 'HOW TO ORDER.txt', size: txt.length, crc: C.crc32(txt), data: txt });
      const zip = new Blob(C.zipParts(zipFiles), { type: 'application/zip' });

      state.zipUrl = URL.createObjectURL(zip);
      const a = el('a', { href: state.zipUrl, download: ZIP_NAME });
      document.body.appendChild(a);
      a.click();
      a.remove();
      els.again.href = state.zipUrl;
      els.again.setAttribute('download', ZIP_NAME);
      els.again.hidden = false;
      els.meter.hidden = true;
      setStatus(els.dlStatus, 'Saved ' + ZIP_NAME + ' to your downloads: ' + plural(plan.slots.length, 'card', 'cards') + ', ' + megabytes(total) + '. Follow the steps below to order.', '');
    } catch (e) {
      els.meter.hidden = true;
      setStatus(els.dlStatus, failureMessage(e), 'bad');
    }
    setBusy(false);
  }

  /* ---------- wiring ---------- */

  els.find.addEventListener('click', findCards);
  els.download.addEventListener('click', downloadFiles);
  /* The example only shows while both boxes are empty, so it can never overwrite a pasted list.
     Clearing can be undone until something new is typed. */
  let undo = null;
  function syncQuietButtons() {
    const empty = !els.deckA.value.trim() && !els.deckB.value.trim();
    els.example.hidden = !empty;
    els.clear.hidden = empty && !undo;
    els.clear.textContent = undo ? 'Put my lists back' : 'Clear both lists';
  }

  els.example.addEventListener('click', () => {
    undo = null;
    els.deckA.value = EXAMPLE_A;
    els.deckB.value = EXAMPLE_B;
    saveDraft();
    syncQuietButtons();
    findCards();
  });
  els.clear.addEventListener('click', () => {
    if (undo) {
      els.deckA.value = undo.a;
      els.deckB.value = undo.b;
      undo = null;
      setStatus(els.status, 'Your lists are back. Press Find my cards.', '');
    } else {
      undo = { a: els.deckA.value, b: els.deckB.value };
      els.deckA.value = '';
      els.deckB.value = '';
      state.decks = [[], []];
      state.plan = null;
      state.overrides.clear();
      resetDownload();
      render();
      setStatus(els.status, 'Lists cleared.', '');
    }
    saveDraft();
    syncQuietButtons();
    els.deckA.focus();
  });

  let draftTimer = null;
  [els.deckA, els.deckB].forEach((t) => t.addEventListener('input', () => {
    undo = null;
    syncQuietButtons();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }));
  els.optMark.addEventListener('change', () => { saveDraft(); resetDownload(); });
  [els.srcScryfall, els.srcMpc].forEach((r) => r.addEventListener('change', () => { saveDraft(); if (state.plan) render(); }));
  els.copyList.addEventListener('click', copyList);
  els.optBasics.addEventListener('change', () => { saveDraft(); replan(); });
  els.optSideboard.addEventListener('change', () => {
    saveDraft();
    /* Sideboard cards may not have been looked up yet, so run the search again. Known cards are not asked for twice. */
    if (state.plan) findCards();
  });

  els.proof.addEventListener('click', (ev) => {
    const b = ev.target.closest ? ev.target.closest('button.face') : null;
    if (!b || !state.plan) return;
    const slot = state.plan.slots[Number(b.getAttribute('data-slot'))];
    if (slot) openPicker(b.getAttribute('data-side') === 'back' ? slot.back : slot.front);
  });
  els.pickerClose.addEventListener('click', closePicker);
  els.pickerMore.addEventListener('click', loadPrints);
  els.picker.addEventListener('close', () => { picker = null; });
  els.picker.addEventListener('click', (ev) => { if (ev.target === els.picker) closePicker(); });

  loadDraft();
  syncQuietButtons();
  render();

  /* For automated tests only. */
  window.__dtp = { state: state, composeFace: composeFace, composeBlank: composeBlank, findCards: findCards, downloadFiles: downloadFiles, faceCache: faceCache };
})();
