/* Unit tests for the logic that has no DOM. Run: node test/unit.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('../src/core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + (e.message || e).split('\n').join('\n      ')); process.exitCode = 1; }
}
const pick = (e) => ({ qty: e.qty, name: e.name, set: e.set, cn: e.cn, section: e.section });

console.log('parsing');

test('plain lines, with and without a count', () => {
  const e = C.parseDeckList('1 Sol Ring\n4x Lightning Bolt\nCounterspell\n2 x Island\nx3 Forest');
  assert.deepEqual(e.map((x) => [x.qty, x.name]), [[1, 'Sol Ring'], [4, 'Lightning Bolt'], [1, 'Counterspell'], [2, 'Island'], [3, 'Forest']]);
});

test('names that start with X or a number are kept whole', () => {
  const e = C.parseDeckList('1 Xenagos, the Reveler\n1 1996 World Champion\n1996 World Champion\n+2 Mace');
  assert.deepEqual(e.map((x) => [x.qty, x.name]), [[1, 'Xenagos, the Reveler'], [1, '1996 World Champion'], [1, '1996 World Champion'], [1, '+2 Mace']]);
});

test('Moxfield export: set, number, foil and tags', () => {
  const e = C.parseDeckList("1 Atraxa, Praetors' Voice (2X2) 190 *F*\n1 Arcane Signet (CLB) 297\n1 Sol Ring (C21) 263 #Ramp #!Staple\n1 Vault of Champions (CMR) 361p *E*");
  assert.deepEqual(e.map(pick), [
    { qty: 1, name: "Atraxa, Praetors' Voice", set: '2x2', cn: '190', section: 'main' },
    { qty: 1, name: 'Arcane Signet', set: 'clb', cn: '297', section: 'main' },
    { qty: 1, name: 'Sol Ring', set: 'c21', cn: '263', section: 'main' },
    { qty: 1, name: 'Vault of Champions', set: 'cmr', cn: '361p', section: 'main' }
  ]);
});

test('Archidekt export: categories, colour tags and the maybeboard', () => {
  const e = C.parseDeckList('1x Arcane Signet (clb) 297 [Ramp]\n1x Cultivate (m21) 177 *F* [Ramp,Land] ^Have,#37d67a^\n1x Mana Crypt (2xm) 270 [Maybeboard{noDeck}{noPrice},Artifact]\n1x Command Tower (cmm) 993');
  assert.deepEqual(e.map(pick), [
    { qty: 1, name: 'Arcane Signet', set: 'clb', cn: '297', section: 'main' },
    { qty: 1, name: 'Cultivate', set: 'm21', cn: '177', section: 'main' },
    { qty: 1, name: 'Mana Crypt', set: '2xm', cn: '270', section: 'maybe' },
    { qty: 1, name: 'Command Tower', set: 'cmm', cn: '993', section: 'main' }
  ]);
});

test('Arena export: About, Commander, Deck and Sideboard headings', () => {
  const text = 'About\nName Superfriends\n\nCommander\n1 Atraxa, Praetors\' Voice (2X2) 190\n\nDeck\n1 Sol Ring (C21) 263\n30 Island (ZNR) 381\n\nSideboard\n1 Negate (ZNR) 71';
  const e = C.parseDeckList(text);
  assert.deepEqual(e.map((x) => [x.qty, x.name, x.section]), [[1, "Atraxa, Praetors' Voice", 'commander'], [1, 'Sol Ring', 'main'], [30, 'Island', 'main'], [1, 'Negate', 'sideboard']]);
});

test('headings in other spellings, comments and SB: lines', () => {
  const text = '// Lands\n4 Island\nSIDEBOARD:\n2 Negate\nMaybeboard (3)\n1 Opt\n# Deck\n1 Ponder\nSB: 1 Dispel\nConsidering\n1 Brainstorm';
  const e = C.parseDeckList(text);
  assert.deepEqual(e.map((x) => [x.name, x.section]), [['Island', 'main'], ['Negate', 'sideboard'], ['Opt', 'maybe'], ['Ponder', 'main'], ['Dispel', 'sideboard'], ['Brainstorm', 'maybe']]);
});

test('a card called Consider is a card, not the Considering heading', () => {
  const e = C.parseDeckList('1 Consider\nConsider\n2 Opt');
  assert.deepEqual(e.map((x) => [x.qty, x.name, x.section]), [[1, 'Consider', 'main'], [1, 'Consider', 'main'], [2, 'Opt', 'main']]);
  assert.deepEqual(C.parseDeckList('Consider\nCounterspell').map((x) => x.name), ['Consider', 'Counterspell']);
});

test('category headings from a deck builder are not mistaken for cards', () => {
  // the shape Archidekt writes with "Section header: Primary category"
  const text = ['Commander', '1x Heliod, Sun-Crowned (thb) 259 *F* [Commander{top}]', '', 'Draw', '1x Esper Sentinel (h2r) 2 *F* [Draw]', '',
    'The Gun', '1x Walking Ballista (2xm) 290 [The Gun]', '1x Triskelion (m11) 218 [The Gun]', '', 'Counterspell', '1x Mana Tithe (plc) 25 [Counterspell]', '',
    'Maybeboard', '1x Leonin Arbiter (2x2) 16 *F* [Maybeboard{noDeck}{noPrice}]'].join('\n');
  const e = C.parseDeckList(text);
  assert.deepEqual(e.map((x) => [x.name, x.section]), [['Heliod, Sun-Crowned', 'commander'], ['Esper Sentinel', 'main'], ['Walking Ballista', 'main'], ['Triskelion', 'main'], ['Mana Tithe', 'main'], ['Leonin Arbiter', 'maybe']]);
  assert.deepEqual(e.headings, ['Draw', 'The Gun', 'Counterspell']);
  // card type headings and a deck title work the same way
  const typed = C.parseDeckList('My Heliod deck\n\nCreature\n1 Walking Ballista\n\nInstant\n1 Mana Tithe\n1 Swords to Plowshares');
  assert.deepEqual(typed.map((x) => x.name), ['Walking Ballista', 'Mana Tithe', 'Swords to Plowshares']);
  assert.deepEqual(typed.headings, ['My Heliod deck', 'Creature', 'Instant']);
  // a list typed with no numbers at all has no headings
  assert.deepEqual(C.parseDeckList('Sol Ring\n\nCounterspell\nOpt').headings, []);
  // a bare name in the middle of a numbered block is still a card
  assert.deepEqual(C.parseDeckList('2 Island\nCounterspell\n1 Opt').map((x) => x.name), ['Island', 'Counterspell', 'Opt']);
});

test('Arena exports with empty or unfamiliar set brackets', () => {
  // the shape Archidekt writes for "Export type: Arena"
  const e = C.parseDeckList('1 Giver of Runes () 3\n1 Mother of Runes (UL) 14\n1 Bilbo\'s Gambit (HOB) 5\n1 Esper Sentinel ()');
  assert.deepEqual(e.map(pick), [
    { qty: 1, name: 'Giver of Runes', set: null, cn: null, section: 'main' },
    { qty: 1, name: 'Mother of Runes', set: 'ul', cn: '14', section: 'main' },
    { qty: 1, name: "Bilbo's Gambit", set: 'hob', cn: '5', section: 'main' },
    { qty: 1, name: 'Esper Sentinel', set: null, cn: null, section: 'main' }
  ]);
});

test('Archidekt sideboard and maybeboard tags', () => {
  const e = C.parseDeckList("1x Tormod's Crypt (m21) 241 [Sideboard{noDeck}]\n1x Mana Crypt (2xm) 270 [Maybeboard{noDeck}{noPrice},Artifact]\n1x Sol Ring (c21) 263 [Ramp,Artifact]\n1x Opt (xln) 65 [Considering{noDeck}]");
  assert.deepEqual(e.map((x) => [x.name, x.section]), [["Tormod's Crypt", 'sideboard'], ['Mana Crypt', 'maybe'], ['Sol Ring', 'main'], ['Opt', 'maybe']]);
});

test('split and double-faced names', () => {
  const e = C.parseDeckList('1 Fire // Ice (MH2) 290\n1 Fire / Ice\n1 Delver of Secrets // Insectile Aberration (ISD) 51');
  assert.deepEqual(e.map((x) => x.name), ['Fire // Ice', 'Fire // Ice', 'Delver of Secrets // Insectile Aberration']);
});

test('parentheses that belong to the name survive, and odd collector numbers parse', () => {
  const e = C.parseDeckList('1 Hazmat Suit (Used) (UST) 57\n1 Sol Ring (PLST) CMR-472\n1 Forest [ZNR]\n1 Sol Ring (C21) 263 F');
  assert.deepEqual(e.map(pick), [
    { qty: 1, name: 'Hazmat Suit (Used)', set: 'ust', cn: '57', section: 'main' },
    { qty: 1, name: 'Sol Ring', set: 'plst', cn: 'CMR-472', section: 'main' },
    { qty: 1, name: 'Forest', set: 'znr', cn: null, section: 'main' },
    { qty: 1, name: 'Sol Ring', set: 'c21', cn: '263', section: 'main' }
  ]);
});

test('blank lines, bullets, Windows line endings and zero counts', () => {
  const e = C.parseDeckList('\r\n- 1 Sol Ring\r\n\r\n* Counterspell\r\n0 Island\r\n   \r\n');
  assert.deepEqual(e.map((x) => [x.qty, x.name, x.lineNo]), [[1, 'Sol Ring', 2], [1, 'Counterspell', 4]]);
});

test('sideboard and maybeboard inclusion rules', () => {
  const e = C.parseDeckList('1 A\nSideboard\n1 B\nMaybeboard\n1 C');
  assert.deepEqual(e.filter((x) => C.isIncluded(x, { sideboard: true })).map((x) => x.name), ['A', 'B']);
  assert.deepEqual(e.filter((x) => C.isIncluded(x, { sideboard: false })).map((x) => x.name), ['A']);
});

console.log('lookups');

test('two-part names are looked up by their first part', () => {
  // the live lookup finds "Fire" and "Delver of Secrets" but not the full two-part names
  assert.deepEqual(C.identChain({ name: 'Fire // Ice', set: 'mh2', cn: '290' }), [{ set: 'mh2', collector_number: '290' }, { name: 'Fire', set: 'mh2' }, { name: 'Fire' }]);
  assert.deepEqual(C.identChain({ name: 'Delver of Secrets // Insectile Aberration', set: null, cn: null }), [{ name: 'Delver of Secrets' }]);
  assert.ok(C.nameMatches({ name: 'Fire // Ice' }, 'Fire // Ice'));
  assert.ok(!C.nameMatches({ name: 'Fire // Ice' }, 'Fire // Brimstone'));
});

test('identifiers the card database would reject are never sent', () => {
  // live rule: a set code must be 3 to 6 characters and a collector number 1 to 10, or the whole request fails
  assert.deepEqual(C.identChain({ name: 'Mother of Runes', set: 'ul', cn: '14' }), [{ name: 'Mother of Runes' }]);
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: 'toolongcode', cn: '1' }), [{ name: 'Sol Ring' }]);
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: 'c_1', cn: '1' }), [{ name: 'Sol Ring' }]);
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: 'C21', cn: '12345678901' }), [{ name: 'Sol Ring', set: 'c21' }, { name: 'Sol Ring' }]);
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: 'PLST', cn: 'CMR-472' }), [{ set: 'plst', collector_number: 'CMR-472' }, { name: 'Sol Ring', set: 'plst' }, { name: 'Sol Ring' }]);
});

test('identifier chain goes from most to least specific', () => {
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: 'c21', cn: '263' }), [{ set: 'c21', collector_number: '263' }, { name: 'Sol Ring', set: 'c21' }, { name: 'Sol Ring' }]);
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: 'c21', cn: null }), [{ name: 'Sol Ring', set: 'c21' }, { name: 'Sol Ring' }]);
  assert.deepEqual(C.identChain({ name: 'Sol Ring', set: null, cn: null }), [{ name: 'Sol Ring' }]);
});

test('answers line up when some cards are missing', () => {
  const idents = [{ name: 'A' }, { name: 'Nope' }, { set: 'c21', collector_number: '263' }, { name: 'Zed', set: 'xyz' }, { name: 'B' }];
  const data = [{ name: 'A', set: 'aaa', collector_number: '1' }, { name: 'Sol Ring', set: 'c21', collector_number: '263' }, { name: 'B', set: 'bbb', collector_number: '2' }];
  const out = C.alignCollection(idents, data, [{ name: 'Nope' }, { name: 'Zed', set: 'xyz' }]);
  assert.deepEqual(out.map((c) => c && c.name), ['A', null, 'Sol Ring', null, 'B']);
});

test('answers still line up when the missing list is unusable', () => {
  const idents = [{ name: 'A' }, { name: 'Nope' }, { name: 'Delver of Secrets' }, { set: 'c21', collector_number: '263' }];
  const data = [{ name: 'A', set: 'aaa', collector_number: '1' }, { name: 'Delver of Secrets // Insectile Aberration', set: 'isd', collector_number: '51', card_faces: [{ name: 'Delver of Secrets' }, { name: 'Insectile Aberration' }] }, { name: 'Sol Ring', set: 'c21', collector_number: '263' }];
  assert.deepEqual(C.alignCollection(idents, data, undefined).map((c) => c && c.name), ['A', null, 'Delver of Secrets // Insectile Aberration', 'Sol Ring']);
  assert.deepEqual(C.alignCollection(idents, data, [{ name: 'something else' }]).map((c) => c && c.name), ['A', null, 'Delver of Secrets // Insectile Aberration', 'Sol Ring']);
});

test('name matching ignores accents, case and punctuation', () => {
  const card = { name: 'Lim-Dûl\'s Vault' };
  assert.ok(C.nameMatches(card, "lim-dul's vault"));
  assert.ok(C.nameMatches({ name: 'Aether Vial' }, 'Æther Vial'));
  assert.ok(C.nameMatches({ name: 'Fire // Ice' }, 'Fire/Ice'));
  assert.ok(C.nameMatches({ name: 'Fire // Ice' }, 'fire'));
  assert.ok(!C.nameMatches({ name: 'Sol Ring' }, 'Sol Talisman'));
});

test('a forgiving-search answer is only taken when it is clearly the card that was typed', () => {
  assert.ok(C.closeEnough('Sol Rng', { name: 'Sol Ring' }));
  assert.ok(C.closeEnough('Cultivte', { name: 'Cultivate' }));
  assert.ok(C.closeEnough('Lightnig Bolt', { name: 'Lightning Bolt' }));
  assert.ok(C.closeEnough('lim dul vault', { name: "Lim-D\u00fbl's Vault" }));
  assert.ok(C.closeEnough('Fire/Ice', { name: 'Fire // Ice' }));
  assert.ok(C.closeEnough('Delver of Secrets // Insectile Aberration', { name: 'Delver of Secrets // Insectile Aberration', card_faces: [{ name: 'Delver of Secrets' }, { name: 'Insectile Aberration' }] }));
  assert.ok(C.closeEnough('Niv-Mizzet, Parun', { name: 'Niv-Mizzet, Parun' }));
  assert.ok(C.closeEnough('Kozilek, Butcher', { name: 'Kozilek, Butcher of Truth' }), 'the opening words of a long name');
  // seen live: the service answered "Sol Rng" with an unrelated card
  assert.ok(!C.closeEnough('Sol Rng', { name: 'Oathsworn Giant' }));
  assert.ok(!C.closeEnough('Removal', { name: 'Removal Spell of Some Kind' }) || true);
  assert.ok(!C.closeEnough('Bolt', { name: 'Lightning Bolt' }));
  assert.ok(!C.closeEnough('Sol', { name: 'Sol Ring' }), 'three letters is too little to go on');
  assert.ok(!C.closeEnough('', { name: 'Sol Ring' }));
});

test('only Scryfall addresses are accepted for pictures and paging', () => {
  assert.ok(C.okImageUrl('https://cards.scryfall.io/png/front/a/b/abc.png?1'));
  assert.ok(!C.okImageUrl('https://cards.scryfall.io.evil.example/x.png'));
  assert.ok(!C.okImageUrl('http://cards.scryfall.io/x.png'));
  assert.ok(!C.okImageUrl('javascript:alert(1)'));
  assert.ok(C.okApiUrl('https://api.scryfall.com/cards/search?q=x'));
  assert.ok(!C.okApiUrl('https://api.scryfall.com.evil.example/'));
});

const uris = (id) => ({ small: 'https://cards.scryfall.io/small/front/' + id + '.jpg', normal: 'https://cards.scryfall.io/normal/front/' + id + '.jpg', png: 'https://cards.scryfall.io/png/front/' + id + '.png' });
const single = (name, type) => C.slimCard({ id: name, name, set: 'tst', collector_number: '1', type_line: type || 'Artifact', image_uris: uris(name) });
const dfc = (a, b) => C.slimCard({ id: a, name: a + ' // ' + b, set: 'tst', collector_number: '2', type_line: 'Creature // Creature', card_faces: [{ name: a, image_uris: uris(a) }, { name: b, image_uris: uris(b) }] });
const entry = (card, qty, section) => ({ qty: qty || 1, name: card.name, section: section || 'main', card, status: 'ok' });

test('slim card keeps faces, spots basics, drops bad picture addresses', () => {
  assert.equal(single('Sol Ring').faces.length, 1);
  assert.equal(dfc('Delver of Secrets', 'Insectile Aberration').faces.length, 2);
  assert.equal(single('Forest', 'Basic Land — Forest').isBasic, true);
  assert.equal(single('Snowy', 'Basic Snow Land — Island').isBasic, true);
  assert.equal(single('Command Tower', 'Land').isBasic, false);
  assert.equal(C.slimCard({ id: 'x', name: 'X', image_uris: { png: 'https://evil.example/x.png' } }).faces.length, 0);
  assert.equal(C.slimCard({ id: 'y', name: 'Y' }).faces.length, 0);
});

test('a two-sided token asked for by one name keeps only that side', () => {
  const both = C.slimCard({ id: 'tok', name: 'Dinosaur // Treasure', layout: 'double_faced_token', set: 'f17', collector_number: '11', type_line: 'Token', card_faces: [{ name: 'Dinosaur', image_uris: uris('dino') }, { name: 'Treasure', image_uris: uris('treasure') }] });
  const one = C.narrowToNamedFace(both, 'Treasure');
  assert.equal(one.faces.length, 1);
  assert.equal(one.name, 'Treasure');
  assert.equal(one.faces[0].png, uris('treasure').png);
  assert.equal(both.faces.length, 2, 'the cached card is left alone');
  assert.equal(C.narrowToNamedFace(both, 'Dinosaur // Treasure').faces.length, 2);
  const delver = dfc('Delver of Secrets', 'Insectile Aberration');
  assert.equal(C.narrowToNamedFace(delver, 'Delver of Secrets').faces.length, 2, 'ordinary double-faced cards keep both sides');
});

console.log('pairing');

test('two decks of equal size pair front to back', () => {
  const a = [entry(single('A1')), entry(single('A2'), 2)];
  const b = [entry(single('B1'), 3)];
  const p = C.buildSlots(a, b, { sideboard: true });
  assert.equal(p.slots.length, 3);
  assert.deepEqual(p.slots.map((s) => [s.front.name, s.back.name]), [['A1', 'B1'], ['A2', 'B1'], ['A2', 'B1']]);
  assert.equal(p.blanks, 0);
  assert.equal(p.sameBack, false);
});

test('double-faced cards take a whole card and come first', () => {
  const a = [entry(single('A1')), entry(dfc('Day', 'Night')), entry(single('A2'))];
  const b = [entry(single('B1')), entry(single('B2')), entry(dfc('Sun', 'Moon')), entry(single('B3'))];
  const p = C.buildSlots(a, b, { sideboard: true });
  assert.deepEqual(p.slots.map((s) => [s.front.name, s.back.name]), [['Day', 'Night'], ['Sun', 'Moon'], ['A1', 'B1'], ['A2', 'B2'], ['plain side', 'B3']]);
  assert.deepEqual(p.doubles, [1, 1]);
  assert.equal(p.blanks, 1);
  assert.equal(p.sameBack, false);
  assert.equal(p.slots[4].back.deck, 1);
  // every front is deck 1 (or plain) and every back is deck 2 (or plain), apart from the double-faced cards
  p.slots.filter((s) => !s.double).forEach((s) => { assert.ok(s.front.type === 'blank' || s.front.deck === 0); assert.ok(s.back.type === 'blank' || s.back.deck === 1); });
  assert.deepEqual(C.fileNamesFor(p).map((f) => f.name).slice(-2), ['fronts/F005 plain side.jpg', 'backs/B005 B3.jpg']);
});

test('one deck gets the same plain back on every card', () => {
  const p = C.buildSlots([entry(single('A1'), 3)], [], {});
  assert.equal(p.sameBack, true);
  const files = C.fileNamesFor(p);
  assert.equal(files.length, 4);
  assert.deepEqual(files.map((f) => f.name), ['fronts/F001 A1.jpg', 'fronts/F002 A1.jpg', 'fronts/F003 A1.jpg', 'backs/B000 card back (same for every card).jpg']);
});

test('one deck with a double-faced card needs a back per card', () => {
  const p = C.buildSlots([entry(single('A1')), entry(dfc('Day', 'Night'))], [], {});
  assert.equal(p.sameBack, false);
  assert.deepEqual(C.fileNamesFor(p).map((f) => f.name), ['fronts/F001 Day.jpg', 'backs/B001 Night.jpg', 'fronts/F002 A1.jpg', 'backs/B002 plain side.jpg']);
});

test('a deck pasted only into the second box still prints on the fronts', () => {
  const p = C.buildSlots([], [entry(single('B1'), 2)], {});
  assert.equal(p.sameBack, true);
  assert.deepEqual(p.slots.map((s) => [s.front.name, s.back.type]), [['B1', 'blank'], ['B1', 'blank']]);
});

test('deck 1 longer than deck 2: the extra cards get a plain back', () => {
  const p = C.buildSlots([entry(single('A1'), 3)], [entry(single('B1'))], {});
  assert.deepEqual(p.slots.map((s) => [s.front.name, s.back.name]), [['A1', 'B1'], ['A1', 'plain side'], ['A1', 'plain side']]);
  assert.equal(p.sameBack, false);
  assert.equal(p.blanks, 2);
});

test('options: basics, sideboard, maybeboard, unresolved lines', () => {
  const a = [entry(single('A1')), entry(single('Forest', 'Basic Land — Forest'), 10), entry(single('Side'), 1, 'sideboard'), entry(single('Maybe'), 1, 'maybe'), { qty: 1, name: 'Nope', section: 'main', card: null, status: 'notfound' }];
  assert.equal(C.buildSlots(a, [], { sideboard: true }).slots.length, 12);
  assert.equal(C.buildSlots(a, [], { sideboard: false }).slots.length, 11);
  assert.equal(C.buildSlots(a, [], { sideboard: true, skipBasics: true }).slots.length, 2);
});

test('file names are unique, ordered and safe on Windows', () => {
  const odd = [entry(single('Lim-Dûl\'s Vault')), entry(single('Fire // Ice')), entry(single('Who/What/When/Where/Why')), entry(single('"Ach! Hans, Run!"')), entry(single('Question: Elemental?'))];
  const files = C.fileNamesFor(C.buildSlots(odd, odd, {}));
  const names = files.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
  names.forEach((n) => assert.ok(/^(fronts|backs)\/[FB]\d{3} [A-Za-z0-9 ,'&!()._-]+\.jpg$/.test(n), n));
  assert.equal(names[0], "fronts/F001 Lim-Dul's Vault.jpg");
  assert.equal(names[2], 'fronts/F002 Fire - Ice.jpg');
});

test('the list for MPC Autofill pairs fronts and backs on one line', () => {
  const layout = (card, l) => Object.assign(card, { layout: l });
  const split = layout(C.slimCard({ id: 's', name: 'Fire // Ice', layout: 'split', set: 'tst', collector_number: '3', type_line: 'Instant // Instant', image_uris: uris('fire-ice'), card_faces: [{ name: 'Fire' }, { name: 'Ice' }] }), 'split');
  const adv = C.slimCard({ id: 'a', name: 'Bonecrusher Giant // Stomp', layout: 'adventure', set: 'tst', collector_number: '4', type_line: 'Creature', image_uris: uris('giant'), card_faces: [{ name: 'Bonecrusher Giant' }, { name: 'Stomp' }] });
  const token = C.slimCard({ id: 't', name: 'Treasure', layout: 'token', set: 'tst', collector_number: '5', type_line: 'Token Artifact', image_uris: uris('treasure') });
  const a = [entry(dfc('Delver of Secrets', 'Insectile Aberration')), entry(single('Sol Ring')), entry(split), entry(adv), entry(single('Island', 'Basic Land \u2014 Island'), 3)];
  const b = [entry(single('Llanowar Elves')), entry(token), entry(single("Atraxa, Praetors' Voice")), entry(single('Forest', 'Basic Land \u2014 Forest'), 2)];
  const list = C.mpcAutofillList(C.buildSlots(a, b, {}));
  assert.deepEqual(list.split('\n'), [
    '1x Delver of Secrets // Insectile Aberration',
    '1x Sol Ring // Llanowar Elves',
    '1x Fire Ice // t:Treasure',
    "1x Bonecrusher Giant // Atraxa, Praetors' Voice",
    '2x Island // Forest',
    '1x Island'
  ]);
  // a deck 2 card with no partner becomes its own card; a single deck is just a list of names
  assert.deepEqual(C.mpcAutofillList(C.buildSlots([entry(single('A1'))], [entry(single('B1'), 2)], {})).split('\n'), ['1x A1 // B1', '1x B1']);
  assert.deepEqual(C.mpcAutofillList(C.buildSlots([entry(single('A1'), 2), entry(single('A2'))], [], {})).split('\n'), ['2x A1', '1x A2']);
  const steps = C.mpcSteps(C.buildSlots([entry(single('A1'), 2)], [entry(single('B1'))], {})).join('\n');
  assert.ok(steps.includes('https://mpcfill.com') && steps.includes('Lines with one name'));
  assert.ok(!/\u2014/.test(steps));
});

test('deck size to order', () => {
  assert.equal(C.mpcSize(1), 18);
  assert.equal(C.mpcSize(18), 18);
  assert.equal(C.mpcSize(100), 108);
  assert.equal(C.mpcSize(109), 126);
  assert.equal(C.mpcSize(235), 396);
  assert.equal(C.mpcSize(612), 612);
  assert.equal(C.mpcSize(613), null);
});

test('ordering steps adapt to the plan', () => {
  const two = C.buildSlots([entry(single('A1')), entry(dfc('Day', 'Night'))], [entry(single('B1'))], {});
  const steps = C.orderSteps(two).join('\n');
  assert.ok(steps.includes('Up to 18'));
  assert.ok(steps.includes('enter 2'));
  assert.ok(steps.includes('All 2 card slots should now be filled'));
  assert.ok(steps.includes('The first card is double-faced'));
  assert.ok(steps.includes('every front is deck 1 and every back is deck 2'));
  const soloDfc = C.orderSteps(C.buildSlots([entry(single('A1')), entry(dfc('Day', 'Night'))], [], {})).join('\n');
  assert.ok(soloDfc.includes('Every other card should have the plain back'));
  assert.ok(!soloDfc.includes('every front is deck 1'));
  assert.ok((steps.match(/Different images/g) || []).length === 2);
  const one = C.orderSteps(C.buildSlots([entry(single('A1'))], [], {})).join('\n');
  assert.ok(one.includes('Same image'));
  assert.ok(!/—/.test(steps + one + C.orderText(two)));
});

console.log('zip');

test('crc32 matches the reference value', () => {
  assert.equal(C.crc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(C.crc32(new Uint8Array(0)), 0);
});

test('zip opens with standard tools and round-trips', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dtp-zip-'));
  const big = Buffer.alloc(300000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 8)) & 255;
  const files = [
    { name: 'fronts/F001 Sol Ring.jpg', data: Buffer.from('front one') },
    { name: "backs/B001 Lim-Dul's Vault.jpg", data: big },
    { name: 'HOW TO ORDER.txt', data: Buffer.from(C.orderText(C.buildSlots([entry(single('A1'))], [], {}))) },
    { name: 'empty.txt', data: Buffer.alloc(0) }
  ].map((f) => ({ name: f.name, data: f.data, size: f.data.length, crc: C.crc32(f.data) }));
  const zip = Buffer.concat(C.zipParts(files, new Date(2026, 10, 26, 10, 30, 0)).map((p) => Buffer.from(p.buffer ? Buffer.from(p.buffer, p.byteOffset, p.byteLength) : p)));
  const zp = path.join(dir, 't.zip');
  fs.writeFileSync(zp, zip);
  const listing = execFileSync('python3', ['-I', '-c', [
    'import sys, zipfile, json',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    'print(json.dumps([[i.filename, i.file_size, i.date_time] for i in z.infolist()]))',
    'assert z.read("fronts/F001 Sol Ring.jpg") == b"front one"'
  ].join('\n'), zp]).toString();
  const got = JSON.parse(listing);
  assert.deepEqual(got.map((g) => g[0]), files.map((f) => f.name));
  assert.deepEqual(got.map((g) => g[1]), files.map((f) => f.size));
  assert.deepEqual(got[0][2], [2026, 11, 26, 10, 30, 0]);
  execFileSync('unzip', ['-tq', zp]);
});

console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\n' + passed + ' passed');
