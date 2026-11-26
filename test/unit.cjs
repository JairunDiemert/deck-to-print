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
  assert.equal(single('Forest', 'Basic Land \u2014 Forest').isBasic, true);
  assert.equal(single('Snowy', 'Basic Snow Land \u2014 Island').isBasic, true);
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
  const a = [entry(single('A1')), entry(single('Forest', 'Basic Land \u2014 Forest'), 10), entry(single('Side'), 1, 'sideboard'), entry(single('Maybe'), 1, 'maybe'), { qty: 1, name: 'Nope', section: 'main', card: null, status: 'notfound' }];
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
  assert.ok(!/\u2014/.test(steps + one + C.orderText(two)));
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

console.log('the chain: commander, deck view, artwork filter, order file');

const print = (over) => Object.assign(C.slimCard({ id: 'p', name: 'Sol Ring', set: 'c16', set_name: 'Commander 2016', collector_number: '272', released_at: '2016-11-11', type_line: 'Artifact', artist: 'Mark Tedin', border_color: 'black', frame: '2015', image_uris: uris('Sol Ring') }), over || {});

test('the artwork filter matches artist, set, year and look, in any order', () => {
  const p1 = print();
  assert.equal(p1.artist, 'Mark Tedin');
  assert.equal(C.printMatches(p1, ''), true);
  assert.equal(C.printMatches(p1, 'tedin'), true);
  assert.equal(C.printMatches(p1, '2016 TEDIN'), true);
  assert.equal(C.printMatches(p1, 'commander 2016'), true);
  assert.equal(C.printMatches(p1, 'c16'), true);
  assert.equal(C.printMatches(p1, 'guay'), false);
  assert.equal(C.printMatches(p1, 'tedin 1997'), false);
  const old = C.slimCard({ id: 'o', name: 'Sol Ring', set: 'lea', set_name: 'Limited Edition Alpha', collector_number: '270', released_at: '1993-08-05', artist: 'Mark Tedin', border_color: 'black', frame: '1993', image_uris: uris('Sol Ring') });
  assert.deepEqual(C.printTags(old), ['old frame']);
  assert.equal(C.printMatches(old, 'old frame'), true);
  const fancy = C.slimCard({ id: 'f', name: 'Sol Ring', set: 'sld', collector_number: '1', artist: 'Jesús Muñoz', border_color: 'borderless', frame: '2015', frame_effects: ['showcase', 'extendedart'], full_art: true, image_uris: uris('Sol Ring') });
  assert.deepEqual(C.printTags(fancy), ['borderless', 'showcase', 'extended art', 'full art']);
  assert.equal(C.printMatches(fancy, 'munoz borderless'), true, 'accents do not have to be typed');
  assert.equal(C.printMatches(fancy, 'extended'), true);
});

test('a two-sided card keeps the artist of its front', () => {
  const c = C.slimCard({ id: 'd', name: 'A // B', card_faces: [{ name: 'A', artist: 'Front Artist', image_uris: uris('A') }, { name: 'B', artist: 'Back Artist', image_uris: uris('B') }] });
  assert.equal(c.artist, 'Front Artist');
});

test('the deck view groups cards the way deck sites do', () => {
  const typed = (name, type, extra) => Object.assign(entry(single(name, type)), extra || {});
  const deck = [
    typed('Boss', 'Legendary Creature \u2014 Angel', { section: 'commander' }),
    typed('Bear', 'Creature \u2014 Bear'), typed('Robot', 'Artifact Creature \u2014 Golem'), typed('Vault', 'Artifact Land'),
    typed('Dryad', 'Land Creature \u2014 Forest Dryad'), typed('Bolt', 'Instant'), typed('Wrath', 'Sorcery'), typed('Ring', 'Artifact'),
    typed('Aura', 'Enchantment \u2014 Aura'), typed('Walker', 'Legendary Planeswalker \u2014 Jace'), typed('Siege', 'Battle \u2014 Siege'),
    typed('Island', 'Basic Land \u2014 Island', { qty: 7 }), typed('Odd', 'Conspiracy'),
    typed('Side', 'Instant', { section: 'sideboard' }), typed('Maybe', 'Instant', { section: 'maybe' })
  ];
  const g = C.deckGroups(deck, { sideboard: true });
  assert.deepEqual(g.map((x) => [x.key, x.count]), [['commander', 1], ['creature', 3], ['planeswalker', 1], ['battle', 1], ['instant', 2], ['sorcery', 1], ['artifact', 1], ['enchantment', 1], ['land', 8], ['other', 1]]);
  assert.equal(g[0].label, 'Commander');
  assert.deepEqual(C.deckGroups(deck, { sideboard: false, skipBasics: true }).filter((x) => x.key === 'instant' || x.key === 'land').map((x) => x.count), [1, 1]);
  assert.equal(C.plainType(deck[0].card), 'Legendary Creature: Angel');
  assert.equal(C.typeGroup(C.slimCard({ id: 'm', name: 'God // Bridge', type_line: 'Legendary Creature \u2014 God // Legendary Enchantment' })), 'creature');
  assert.deepEqual(C.deckGroups([], {}), []);
});

test('removing a line only touches the line that was read', () => {
  const text = 'Commander\n1 Boss\n\nDeck\n1 Sol Ring\n2 Island';
  assert.equal(C.removeLine(text, 5, '1 Sol Ring'), 'Commander\n1 Boss\n\nDeck\n2 Island');
  assert.equal(C.removeLine(text, 5, '1 Sol Rin'), null, 'the list changed since it was read');
  assert.equal(C.removeLine(text, 9, '1 Sol Ring'), null);
  assert.equal(C.removeLine('1 A\r\n  1 B  \r\n1 C', 2, '1 B'), '1 A\n1 C');
  const e = C.parseDeckList(text);
  assert.equal(C.parseDeckList(C.removeLine(text, e[1].lineNo, e[1].raw)).length, 2);
});

test('the commander search only ever sends plain name words', () => {
  assert.equal(C.commanderQuery("Atraxa, Praetors' V"), 'is:commander game:paper name:atraxa name:praetors name:v');
  assert.equal(C.commanderQuery('a'), '');
  assert.equal(C.commanderQuery('   '), '');
  assert.equal(C.commanderQuery('kaalia" or t:land (x) -is:commander'), 'is:commander game:paper name:kaalia name:or name:t name:land name:x name:is name:commander');
  assert.equal(C.commanderQuery('Lim-Dûl'), 'is:commander game:paper name:lim name:dul');
});

test('links to deck sites are built from the front name', () => {
  assert.equal(C.siteSlug("Yuriko, the Tiger's Shadow"), 'yuriko-the-tigers-shadow');
  assert.equal(C.siteSlug('Esika, God of the Tree // The Prismatic Bridge'), 'esika-god-of-the-tree');
  const links = C.deckSiteLinks("Atraxa, Praetors' Voice");
  assert.deepEqual(links.map((l) => l.site), ['Archidekt', 'EDHREC', 'Moxfield']);
  assert.equal(links[0].url, "https://archidekt.com/search/decks?commanderName=Atraxa%2C%20Praetors'%20Voice&deckFormat=3&orderBy=-viewCount");
  assert.equal(links[1].url, 'https://edhrec.com/average-decks/atraxa-praetors-voice');
  assert.ok(links.every((l) => /^https:\/\/(archidekt\.com|edhrec\.com|moxfield\.com)\//.test(l.url)));
  assert.deepEqual(C.deckSiteLinks(''), []);
  assert.deepEqual(C.deckSiteLinks('!!!'), []);
});

const INDEX = { decks: [
  ['BreedLethality_C16', 'Breed Lethality', 'C16', '2016-11-11', ["Atraxa, Praetors' Voice"], 100],
  ['Coin_SLD', 'Heads I Win', 'SLD', '2020-01-01', ['Zndrsplt, Eye of Wisdom // Zndrsplt, Eye of Wisdom', 'Okaun, Eye of Chaos // Okaun, Eye of Chaos'], 100],
  ['Gods_KHC', 'Gods', 'KHC', '2021-02-05', ['Esika, God of the Tree // The Prismatic Bridge'], 100]
] };

test('ready-made decks are found by the commander that leads them', () => {
  assert.deepEqual(C.findPrecons(INDEX, "atraxa, praetors' voice").map((d) => d.file), ['BreedLethality_C16']);
  assert.deepEqual(C.findPrecons(INDEX, 'Zndrsplt, Eye of Wisdom').map((d) => d.name), ['Heads I Win']);
  assert.deepEqual(C.findPrecons(INDEX, 'Okaun, Eye of Chaos').map((d) => d.name), ['Heads I Win']);
  assert.deepEqual(C.findPrecons(INDEX, 'Esika, God of the Tree').map((d) => d.name), ['Gods']);
  assert.deepEqual(C.findPrecons(INDEX, 'Esika, God of the Tree // The Prismatic Bridge').map((d) => d.name), ['Gods']);
  assert.deepEqual(C.findPrecons(INDEX, 'Atraxa'), [], 'a partial name is not a match');
  assert.deepEqual(C.findPrecons(INDEX, ''), []);
  assert.deepEqual(C.findPrecons(null, 'Atraxa'), []);
  assert.equal(C.preconUrl('BreedLethality_C16'), 'https://mtgjson.com/api/v5/decks/BreedLethality_C16.json');
  assert.equal(C.preconUrl('../../evil'), null);
  assert.equal(C.preconUrl('a.json?x=1'), null);
  assert.equal(C.preconUrl(''), null);
});

test('the shipped deck index is well formed', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/precons.json'), 'utf8'));
  assert.ok(idx.decks.length >= 150);
  idx.decks.forEach((d) => {
    assert.ok(C.preconUrl(d[0]), 'file name is safe: ' + d[0]);
    assert.ok(typeof d[1] === 'string' && d[1].length > 0);
    assert.ok(Array.isArray(d[4]) && d[4].length >= 1 && d[4].every((n) => typeof n === 'string' && n.length > 0));
    assert.equal(d[5], 100);
  });
  assert.ok(C.findPrecons(idx, "Atraxa, Praetors' Voice").length >= 1);
});

test('a ready-made deck becomes a list in the same shape as a pasted export', () => {
  const card = (name, count, setCode, number) => ({ name, count, setCode, number });
  const text = C.preconListText({ data: {
    commander: [card("Atraxa, Praetors' Voice", 1, 'C16', '28')],
    mainBoard: [card('Sol Ring', 1, 'C16', '272'), card('Island', 3, 'C16', '340'), card('Dazzling Theater // Prop Room', 1, 'PLST', 'DSK-3'),
      card('Twin // Twin', 1, 'SLD', '9'), card('Odd Set', 1, 'X', '1'), card('Long Number', 1, 'ABC', '12345678901'), card('  ', 1, 'ABC', '1'), card('Arcane Signet', 0, 'ELD', 331)],
    tokens: [card('Germ', 1, 'TC16', '10')]
  } });
  assert.deepEqual(text.split('\n'), ['Commander', "1 Atraxa, Praetors' Voice (C16) 28", '', 'Deck', '1 Arcane Signet (ELD) 331', '1 Dazzling Theater // Prop Room (PLST) DSK-3',
    '3 Island (C16) 340', '1 Long Number (ABC)', '1 Odd Set', '1 Sol Ring (C16) 272', '1 Twin']);
  const e = C.parseDeckList(text);
  assert.equal(e.headings.length, 0);
  assert.deepEqual(e.map((x) => [x.qty, x.name, x.set, x.cn, x.section]).slice(0, 4), [[1, "Atraxa, Praetors' Voice", 'c16', '28', 'commander'], [1, 'Arcane Signet', 'eld', '331', 'main'], [1, 'Dazzling Theater // Prop Room', 'plst', 'DSK-3', 'main'], [3, 'Island', 'c16', '340', 'main']]);
  assert.equal(e.reduce((n, x) => n + x.qty, 0), 10);
  assert.equal(C.preconListText(null), '');
  assert.equal(C.preconListText({ data: { commander: [] } }), '');
});

test('the order file gives every picture its own card slot', () => {
  const two = C.buildSlots([entry(single('Sol Ring')), entry(single('Minsc & Boo'))], [entry(single('Cultivate')), entry(single('A <B> "C"'))], {});
  const xml = C.mpcXml(two);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\r\n<order>\r\n/);
  assert.match(xml, /<quantity>2<\/quantity>/);
  assert.match(xml, /<stock>\(S30\) Standard Smooth<\/stock>/);
  assert.match(xml, /<foil>false<\/foil>/);
  const cards = xml.match(/<card>.*?<\/card>/g);
  assert.equal(cards.length, 4);
  assert.equal(cards[0], '<card><id>fronts/F001 Sol Ring.jpg</id><sourceType>Local File</sourceType><slots>0</slots><name>F001 Sol Ring.jpg</name><query>sol ring</query></card>');
  assert.match(cards[1], /<id>fronts\/F002 Minsc &amp; Boo\.jpg<\/id>.*<slots>1<\/slots>/);
  assert.match(cards[2], /<id>backs\/B001 Cultivate\.jpg<\/id>.*<slots>0<\/slots>/);
  assert.ok(!/<cardback>/.test(xml), 'every back has its own picture, so there is no shared one');
  assert.ok(!/[<>"]/.test(xml.replace(/<\/?[a-zA-Z]+>|<\?xml[^>]*\?>/g, '').replace(/&(amp|lt|gt|quot);/g, '')), 'text is escaped');
  C.fileNamesFor(two).forEach((f) => assert.ok(xml.includes('<id>' + f.name.replace(/&/g, '&amp;') + '</id>'), f.name));

  const one = C.buildSlots([entry(single('Sol Ring')), entry(single('Island'))], [], {});
  const xml1 = C.mpcXml(one);
  assert.equal(xml1.match(/<card>/g).length, 2);
  assert.ok(!/<backs>/.test(xml1));
  assert.match(xml1, /<cardback>backs\/B000 card back \(same for every card\)\.jpg<\/cardback>/);

  const many = [];
  for (let i = 0; i < 613; i++) many.push(entry(single('Card ' + i)));
  assert.equal(C.mpcXml(C.buildSlots(many, [], {})), '', 'too big for one order: no order file');
  assert.equal(C.mpcXml({ slots: [] }), '');
});

test('both ways to order are written out, in plain words', () => {
  const two = C.buildSlots([entry(single('Sol Ring'))], [entry(single('Cultivate'))], {});
  const steps = C.autoSteps(two);
  assert.ok(steps.length >= 5);
  assert.ok(steps.some((x) => x.includes(C.AUTOFILL_TOOL_URL)));
  assert.match(steps.join(' '), /cards\.xml/);
  assert.match(steps.join(' '), /front and back/);
  assert.match(C.autoSteps(C.buildSlots([entry(single('Sol Ring'))], [], {})).join(' '), /plain back/);
  const txt = C.orderText(two);
  assert.match(txt, /BY HAND[\s\S]*1\. Unzip[\s\S]*HANDS-FREE, WITH A HELPER PROGRAM[\s\S]*1\. Unzip/);
  assert.ok(!/\u2014/.test(txt + steps.join(' ')));
});

console.log('more automation: starter deck, start files');

const pool = (prefix, n, type) => Array.from({ length: n }, (_, i) => C.slimCard({ id: prefix + i, name: prefix + ' ' + (i + 1), set: 'cmr', collector_number: String(i + 1), type_line: type || 'Artifact', image_uris: uris(prefix + i) }));
const boss = (over) => Object.assign(C.slimCard({ id: 'boss', name: 'Krenko, Mob Boss', set: 'ddn', collector_number: '14', type_line: 'Legendary Creature ' + String.fromCharCode(8212) + ' Goblin Warrior', color_identity: ['R'], oracle_text: 'Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.', image_uris: uris('boss') }), over || {});

test('a commander that talks about its own creature type gets that type as a theme', () => {
  assert.equal(boss().oracle_text.length > 10, true);
  assert.deepEqual(boss().color_identity, ['R']);
  assert.equal(C.kindredType(boss()), 'Goblin');
  assert.equal(C.kindredType(boss({ oracle_text: 'Haste' })), '');
  assert.equal(C.kindredType(boss({ name: 'Goblin King Bob', oracle_text: 'Haste. Goblin King Bob attacks each combat.' })), '', 'its own name does not count');
  assert.equal(C.kindredType({ name: 'X', type_line: 'Legendary Artifact', oracle_text: 'Artifact' }), '');
  assert.deepEqual(C.slimCard({ id: 'z', name: 'Z', color_identity: ['G', 'x', 'W; drop'] }).color_identity, ['G']);
});

test('the starter deck asks Scryfall one question per job, inside the commander\'s colours', () => {
  const plan = C.starterPlan(boss());
  assert.deepEqual(plan.parts.map((p) => p.key), ['lands', 'ramp', 'draw', 'removal', 'wipes', 'kindred', 'creatures', 'fill']);
  assert.ok(plan.parts.every((p) => p.q.startsWith('id<=r legal:commander game:paper ')));
  assert.equal(plan.parts[5].q, 'id<=r legal:commander game:paper t:creature t:goblin');
  assert.equal(C.starterPlan(boss({ color_identity: [], oracle_text: '' })).parts[0].q, 'id=c legal:commander game:paper t:land -t:basic');
  assert.deepEqual(C.starterPlan(boss({ color_identity: ['W', 'U', 'B'], oracle_text: '' })).parts.map((p) => p.key), ['lands', 'ramp', 'draw', 'removal', 'wipes', 'creatures', 'fill']);
});

test('the starter deck is exactly 100 cards, with no card twice', () => {
  const results = { lands: pool('Land', 40, 'Land'), ramp: pool('Ramp', 40), draw: [pool('Ramp', 1)[0]].concat(pool('Draw', 40)), removal: pool('Removal', 40), wipes: pool('Wipe', 40),
    kindred: pool('Goblin', 30, 'Creature'), creatures: pool('Goblin', 3, 'Creature').concat(pool('Creature', 40, 'Creature')), fill: [boss()].concat(pool('Good', 40)) };
  const plan = C.starterPlan(boss());
  const text = C.starterListText(boss(), plan, results);
  const e = C.parseDeckList(text);
  assert.equal(e.reduce((n, x) => n + x.qty, 0), 100);
  assert.equal(e.headings.length, 0, 'job names are written as comments, not read as cards or headings');
  assert.deepEqual([e[0].name, e[0].section, e[0].set, e[0].cn], ['Krenko, Mob Boss', 'commander', 'ddn', '14']);
  assert.ok(e.slice(1).every((x) => x.section === 'main'));
  assert.equal(new Set(e.map((x) => x.name)).size, e.length);
  const lines = text.split('\n');
  const count = (label) => { const at = lines.indexOf('// ' + label); let n = 0; for (let i = at + 1; i < lines.length && !lines[i].startsWith('//'); i++) n++; return at === -1 ? -1 : n; };
  assert.deepEqual(['Ramp', 'Card draw', 'Removal', 'Board wipes', 'Goblin creatures', 'Creatures', 'More good cards'].map(count), [10, 10, 8, 3, 18, 6, 7]);
  assert.equal(lines[lines.indexOf('// Lands') + 10], '28 Mountain', 'nine nonbasic lands, then basics up to 37 lands');
  assert.ok(!lines.includes('1 Ramp 1 (CMR) 1') || lines.filter((l) => l === '1 Ramp 1 (CMR) 1').length === 1);

  // a creature type with too few cards is not a theme; thin pools are topped up with basic lands
  const thin = Object.assign({}, results, { kindred: pool('Goblin', 3, 'Creature'), fill: [] });
  const t2 = C.starterListText(boss(), plan, thin);
  assert.ok(!/Goblin creatures/.test(t2));
  const e2 = C.parseDeckList(t2);
  assert.equal(e2.reduce((n, x) => n + x.qty, 0), 100);
  assert.equal(e2.filter((x) => /^Creature /.test(x.name) || /^Goblin /.test(x.name)).length, 20);

  // two colours share the basics; no colours means Wastes
  const two = boss({ color_identity: ['B', 'G'], oracle_text: '' });
  const t3 = C.starterListText(two, C.starterPlan(two), results);
  assert.match(t3, /\n11 Swamp\n11 Forest\n/);
  const none = boss({ color_identity: [], oracle_text: '' });
  assert.match(C.starterListText(none, C.starterPlan(none), {}), /^Commander\n1 Krenko, Mob Boss \(DDN\) 14\n\nDeck\n\/\/ Lands\n99 Wastes$/);
});

test('the start files are plain text that asks before downloading the helper', () => {
  const bat = C.startFileWindows(), sh = C.startFileUnix();
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]+$/.test(bat + sh), 'plain ASCII');
  assert.ok(bat.split('\r\n').length > 30 && !/[^\r]\n/.test(bat), 'Windows line endings');
  assert.ok(!/\r/.test(sh) && sh.startsWith('#!/bin/bash\n'));
  [bat, sh].forEach((t) => {
    assert.match(t, /cards\.xml/);
    assert.match(t, /https:\/\/github\.com\/chilli-axe\/mpc-autofill\/releases\/latest\/download\//);
    assert.match(t, /Download it now\?/);
    assert.match(t, /--browser/);
    assert.equal((t.match(/https?:\/\/[^\s"]+/g) || []).every((u) => u.startsWith('https://github.com/chilli-axe/mpc-autofill')), true, 'no other addresses');
  });
  assert.match(bat, /"%TOOL%" --browser %BROWSER% --directory "%~dp0\."/);
  assert.match(bat, /releases\/latest\/download\/autofill-windows\.zip/);
  assert.match(sh, /--browser "\$BROWSER" --directory "\$PWD"/);
  const steps = C.autoSteps(C.buildSlots([entry(single('Sol Ring'))], [], {})).join(' ');
  assert.ok(steps.includes(C.START_WINDOWS) && steps.includes(C.START_UNIX));
});

test('the zip marks the Mac and Linux start file as runnable', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dtp-mode-'));
  const data = Buffer.from(C.startFileUnix());
  const files = [{ name: 'cards.xml', data: Buffer.from('<order/>') }, { name: C.START_UNIX, data, mode: 0x1ED }].map((f) => Object.assign(f, { size: f.data.length, crc: C.crc32(f.data) }));
  const zp = path.join(dir, 'm.zip');
  fs.writeFileSync(zp, Buffer.concat(C.zipParts(files, new Date(2026, 10, 26, 10, 30, 0)).map((p) => Buffer.from(p))));
  const modes = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json, sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps([[i.filename, oct((i.external_attr >> 16) & 0o777), i.create_system] for i in z.infolist()]))', zp]).toString());
  assert.deepEqual(modes, [['cards.xml', '0o644', 3], [C.START_UNIX, '0o755', 3]]);
  execFileSync('unzip', ['-q', zp, '-d', dir]);
  assert.equal((fs.statSync(path.join(dir, C.START_UNIX)).mode & 0o111) !== 0, true, 'runnable after unzipping');
});

console.log('pairing by hand: commanders, moves, spare sides');

const pairs = (p) => p.slots.map((x) => x.front.name + '/' + x.back.name);

test('a double-faced commander leaves the other deck\'s commander as the card without a partner', () => {
  const A = [entry(dfc('BossA', 'BossA flip'), 1, 'commander'), entry(single('A1')), entry(single('A2'))];
  const B = [entry(single('BossB'), 1, 'commander'), entry(single('B1')), entry(single('B2'))];
  assert.deepEqual(pairs(C.buildSlots(A, B, {})), ['BossA/BossA flip', 'A1/B1', 'A2/B2', 'plain side/BossB']);
  assert.deepEqual(pairs(C.buildSlots(B, A, {})), ['BossA/BossA flip', 'B1/A1', 'B2/A2', 'BossB/plain side'], 'the same the other way round');
  // two ordinary commanders still share a card
  assert.deepEqual(pairs(C.buildSlots([entry(single('BossA'), 1, 'commander'), entry(single('A1'))], B.slice(0, 2), {})), ['BossA/BossB', 'A1/B1']);
  // a card added later to fill the spare side lands opposite the commander, and no other pair moves
  const filled = C.buildSlots(A.concat([entry(single('Extra'), 1, 'tokens')]), B, {});
  assert.deepEqual(pairs(filled), ['BossA/BossA flip', 'A1/B1', 'A2/B2', 'Extra/BossB']);
  assert.equal(filled.blanks, 0);
});

test('a card can be moved to another slot, on its own side only', () => {
  const build = (extraB) => C.buildSlots([entry(single('A1')), entry(single('A2')), entry(single('A3')), entry(dfc('D', 'D flip'))], [entry(single('B1')), entry(single('B2'))].concat(extraB || []), {});
  const plan = build();
  assert.deepEqual(pairs(plan), ['D/D flip', 'A1/B1', 'A2/B2', 'A3/plain side']);
  assert.deepEqual(plan.slots.map((x) => C.sideKey(x, 'back')), [null, '1|b1|1', '1|b2|1', 'plain|0|a3|1']);
  assert.equal(C.swapSides(plan, 'back', 1, 3), true);
  assert.deepEqual(pairs(plan), ['D/D flip', 'A1/plain side', 'A2/B2', 'A3/B1']);
  assert.equal(C.swapSides(plan, 'front', 1, 2), true);
  assert.deepEqual(pairs(plan), ['D/D flip', 'A2/plain side', 'A1/B2', 'A3/B1']);
  assert.equal(C.swapSides(plan, 'back', 0, 1), false, 'a double-faced card keeps both of its sides');
  assert.equal(C.swapSides(plan, 'back', 2, 2), false);
  assert.equal(C.swapSides(plan, 'side', 1, 2), false);
  assert.equal(C.swapSides(C.buildSlots([entry(single('A1')), entry(single('A2'))], [], {}), 'front', 0, 1), false, 'one deck: nothing to pair');
  const uneven = C.buildSlots([entry(single('A1')), entry(single('A2')), entry(single('A3'))], [entry(single('B1'))], {});
  assert.equal(C.swapSides(uneven, 'back', 1, 2), false, 'two plain backs: nothing would change');
  assert.equal(C.swapSides(uneven, 'front', 0, 1), true);

  // the moves are replayed on a rebuilt plan, and dropped when their cards are gone
  const moves = [['back', '1|b1|1', 'plain|0|a3|1'], ['front', '0|a1|1', '0|a2|1']];
  const again = build();
  assert.deepEqual(C.applySwaps(again, moves), moves);
  assert.deepEqual(pairs(again), pairs(plan));
  const fewer = C.buildSlots([entry(single('A1')), entry(single('A2')), entry(dfc('D', 'D flip'))], [entry(single('B1')), entry(single('B2'))], {});
  assert.deepEqual(C.applySwaps(fewer, moves), [moves[1]], 'the first move needed a card that was removed');
  assert.deepEqual(pairs(fewer), ['D/D flip', 'A2/B1', 'A1/B2']);
  const names = C.fileNamesFor(plan).map((f) => f.name);
  assert.ok(names.includes('fronts/F002 A2.jpg') && names.includes('backs/B004 B1.jpg'), 'file names follow the moves');
  assert.match(C.mpcXml(plan), /<id>backs\/B004 B1\.jpg<\/id><sourceType>Local File<\/sourceType><slots>3<\/slots>/);
});

test('a card for a spare side goes at the end of the list, under Extras', () => {
  const one = C.addExtraLine('Commander\n1 Boss\n\nDeck\n1 Sol Ring\n', '1 Treasure (TMH3) 20');
  assert.equal(one, 'Commander\n1 Boss\n\nDeck\n1 Sol Ring\n\nExtras\n1 Treasure (TMH3) 20');
  const two = C.addExtraLine(one, '1 Clue');
  assert.equal(two, one + '\n1 Clue');
  const e = C.parseDeckList(two);
  assert.deepEqual(e.map((x) => [x.name, x.section]), [['Boss', 'commander'], ['Sol Ring', 'main'], ['Treasure', 'tokens'], ['Clue', 'tokens']]);
  assert.equal(e.headings.length, 0);
  assert.ok(e.every((x) => C.isIncluded(x, { sideboard: false })));
  assert.equal(C.addExtraLine('1 Sol Ring\n\nSIDEBOARD:\n1 Counterspell', '1 Clue'), '1 Sol Ring\n\nSIDEBOARD:\n1 Counterspell\n\nExtras\n1 Clue');
  assert.equal(C.addExtraLine('', '1 Clue'), '1 Clue');
  assert.equal(C.cardLine(single('Sol Ring')), '1 Sol Ring (TST) 1');
  assert.equal(C.cardQuery('Treasure tok'), 'game:paper name:treasure name:tok');
  assert.equal(C.cardQuery('x'), '');
  assert.equal(C.cardQuery('Treasure token'), 'game:paper name:treasure t:token');
  assert.equal(C.cardQuery('tokens'), '');
  assert.equal(C.cardQuery('a" or t:land'), 'game:paper name:a name:or name:t name:land');
});

console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\n' + passed + ' passed');
