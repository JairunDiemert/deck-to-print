# Deck to Print

Paste one or two Magic: The Gathering deck lists and get every card as a print-ready image, numbered in order, ready to upload to a card printer such as MakePlayingCards.

Paste two lists and they share one set of cards: deck 1 goes on the fronts and deck 2 goes on the backs. Sleeve them in opaque sleeves and you have two decks for the price of one print run.

**Use it:** https://jairundiemert.github.io/deck-to-print/

The whole tool is one file, `docs/index.html`. It runs in your browser. There is no server and nothing to install. You can also download that file and open it straight from your computer.

## How to use it

1. **Paste your deck lists.** In Moxfield or Archidekt, open the deck, choose Export, copy the text and paste it in. One card per line, like `1 Sol Ring`.
2. **Check your cards.** Each numbered pair is one printed card, front and back. Select a card to choose different artwork.
3. **Download and order.** You get a zip with a `fronts` folder, a `backs` folder and step-by-step ordering instructions.

## How two decks share one set of cards

- Deck 1 is printed on the fronts and deck 2 on the backs.
- A double-faced card needs both sides of its own card, so it gets a card to itself. Those come first.
- If one deck is longer, the extra cards get a plain other side.
- Every front is deck 1 and every back is deck 2. So if the printer's site shuffles the order of the backs, nothing breaks. Only the double-faced cards need an exact match, and the instructions tell you to check those.
- The page tells you which deck size to order (103 cards means "Up to 108") and how many spare slots that leaves.

## Where the pictures come from

There is a switch with two choices.

**Scryfall** (the default). Official card scans from [Scryfall](https://scryfall.com). The page builds the print files itself:

- 822 x 1122 pixels at 300 dpi, the size MakePlayingCards asks for, trim margin included.
- A 63 x 88 mm card at 300 dpi is 745 x 1040 pixels, which is the size of Scryfall's scans, so each scan is placed as it is with no resizing.
- The margin continues the card's border colour. For cards whose art runs to the edge, the margin mirrors the picture.
- A small "PROXY - NOT FOR SALE" line runs down the right-hand border. It does not cover the artist or copyright line. You can turn it off under Options.
- Cards with no partner get a plain back that says PROXY. The tool never prints an official card back.

**MPC Autofill.** [MPC Autofill](https://mpcfill.com) is a community project with sharper pictures made for printing, and a desktop tool that fills in a MakePlayingCards order for you. Its server only answers its own site, so this page cannot fetch its pictures. Instead, this page pairs your two decks and writes a list in the format that site accepts, one printed card per line as `front // back`. You paste it there and carry on.

## Deck lists it understands

Checked against 15 real export files taken from Archidekt's own Export dialog (two public 100-card decks, each exported with several different settings), looked up on the live Scryfall service and compared with the exact printing Archidekt records for every card:

| Export | Result |
| --- | --- |
| Archidekt Text, default options | Every card found, every printing exact |
| Archidekt Text with section headers (category, card type or generic) | Same. Headings such as "Ramp" or "The Gun" are recognised as headings |
| Archidekt Text with "front name only" for two-part cards | Same |
| Archidekt Text with all options off (names only) | Every card found. Printing is Scryfall's default. Maybeboard cards cannot be told apart, so untick "Include out of deck cards" when you export |
| Archidekt Arena | Every card found. Printing is exact only where Arena's set code matches Scryfall's |

Moxfield blocks automated browsers, so its export could not be captured the same way. Its format (`1 Card Name (SET) 123 *F*`, with a `SIDEBOARD:` heading) is covered by the tests from published descriptions.

Also handled: `4x` counts, lists with no counts, `SB:` lines, comments, foil markers, Moxfield tags, Archidekt categories and colour tags, split and double-faced names, accents, and set codes Scryfall would refuse.

Cards under a Maybeboard or Considering heading are always left out. Sideboard cards are included unless you switch that off.

Deck links are not supported. Moxfield and Archidekt do not let other websites read decks from a browser.

## Things it will not do silently

- A typo is reported as "not found". It is never swapped for a different card. Scryfall's forgiving search sometimes answers with an unrelated card, so its answers are only accepted when the name is a letter or two off.
- A line the card database refuses cannot take the rest of the deck with it.
- Lines read as headings are listed on the page, so a card typed without a number is not lost unnoticed.

## Fair use

This is for personal playtest cards. Do not sell what you print and do not use it in sanctioned events.

Unofficial fan tool. Not affiliated with or endorsed by Wizards of the Coast, Scryfall, MakePlayingCards or MPC Autofill. Card images are copyright Wizards of the Coast and are loaded from Scryfall in your browser when you ask for them. Nothing you paste is sent anywhere except card names and set codes, which go to Scryfall to look the cards up.

The page follows Scryfall's API rules: one batched lookup per 75 cards, at least half a second between requests, and it waits when asked to slow down.

## Working on it

```
npm install
npx playwright install chromium   # or set CHROME_PATH to a Chrome you already have
npm run build                     # writes docs/index.html from src/
npm test                          # logic tests, browser tests, cross-site tests
```

- `src/core.js`: list reading, lookups, pairing, file names, zip. No page code, so it is tested on its own.
- `src/app.js`: the page, the Scryfall calls and the print images.
- `test/mock.cjs`: a stand-in for Scryfall with made-up cards and placeholder pictures, so the tests need no network.
- `test/realnet.cjs`: runs the page through the browser's real network stack against a local server, to check what happens when a server allows or refuses a page opened from a file.
- `test/live/`: checks against the real services. `capture-archidekt.cjs` saves real exports from a public deck into `test/live/samples/` (not committed, they are someone else's deck list). `npm run test:live` then runs them through the real page.

Edit files in `src/`, then run `npm run build`. Do not edit `docs/index.html` by hand.

## Credits

- Card data and scans: [Scryfall](https://scryfall.com/docs/api)
- Typeface: Archivo by Omnibus-Type, SIL Open Font License 1.1
- The `front // back` list format belongs to [MPC Autofill](https://github.com/chilli-axe/mpc-autofill)
