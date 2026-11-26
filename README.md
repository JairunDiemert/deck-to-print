# Deck to Print

Name a commander or paste one or two Magic: The Gathering deck lists, and get every card as a print-ready image, numbered in order, with an order file that a helper program can load into a card printer such as MakePlayingCards.

Paste two lists and they share one set of cards: deck 1 goes on the fronts and deck 2 goes on the backs. Sleeve them in opaque sleeves and you have two decks for the price of one print run.

**Use it:** https://jairundiemert.github.io/deck-to-print/

The whole tool is one file, `docs/index.html`. It runs in your browser. There is no server and nothing to install. You can also download that file and open it straight from your computer.

## How to use it

1. **Choose your decks.** Type a commander's name to get its official ready-made deck, a starter deck built for you, or links to lists other players built. Or paste a list of your own: in Moxfield or Archidekt, open the deck, choose Export, copy the text and paste it in. One card per line, like `1 Sol Ring`.
2. **Check your cards.** Look at them as printed (each numbered pair is one card, front and back) or deck by deck, grouped by card type. Select a card to choose different artwork, and type an artist, a set or a year to narrow the choices. Take a card out with Remove. Drag a card onto another one to swap their places (or use Move a card, which also works on a phone), and select a plain side to fill it with any card or token you search for.
3. **Download and order.** You get a zip with a `fronts` folder, a `backs` folder, an order file (`cards.xml`) and step-by-step instructions for two ways to order: by hand, or hands-free with a helper program.

## One chain, every link editable

Each step only hands text or cards to the next one, so you can step in anywhere and everything after it follows:

| Link | What goes in | What comes out | How to change it |
| --- | --- | --- | --- |
| Commander | A name you type | A list in the deck box | Pick another deck, or press "Put my old list back" |
| Deck list | The text in the box | The cards, looked up | Edit the text at any time. The page marks the later steps as out of date until you press Find my cards |
| Cards | The cards found | Print order, front and back pairs | Change artwork or remove a card in step 2 |
| Print plan | The pairs | Pictures, `cards.xml`, instructions | Download again after any change |
| Order | The download | Your order on the printer's site | By hand, or with the helper program |

### Where a deck for a commander comes from

- **Official ready-made decks.** The page knows which official preconstructed Commander deck each commander leads (178 decks, 183 commanders, from [MTGJSON](https://mtgjson.com)'s open data). Choosing one fetches that single list from MTGJSON and writes it into the box in the same shape as a pasted export, exact printings included. `npm run precons` rebuilds the index when new decks come out.
- **A starter deck for any commander.** "Build it" asks Scryfall's open search for the most played cards in the commander's colours, one question per job: lands, ramp, card draw, removal, board wipes and creatures. If the commander's own text talks about one of its creature types (Krenko and Goblins), creatures of that type come first. The result is always exactly 100 cards. It is a sensible first draft to edit, not a list tuned to the commander.
- **Lists other players built.** For every commander the page links to the most viewed decks on Archidekt, the average deck on EDHREC and the deck browser on Moxfield. These are plain links: you pick a deck there, copy it with that site's own Export or Copy button, and press Paste here. The page does not read those sites, on purpose:
  - EDHREC's terms of service (effective 6 August 2024) allow personal use of the site, and forbid scripts that send it automated requests and copying or republishing its content. There is no exception for a tool like this one, so its average deck stays a link unless EDHREC says otherwise.
  - Archidekt's developers describe their read API as open, but it only answers pages on Archidekt's own address, so a page hosted elsewhere cannot use it.
  - Moxfield blocks other sites from reading its decks.

### The order file

`cards.xml` is for the [MPC Autofill desktop tool](https://github.com/chilli-axe/mpc-autofill/releases/latest), a free community program that works your browser on MakePlayingCards. The file lists every picture in the download as a local file with the exact card slot it belongs in, fronts and backs, so the pairs do not depend on the order files happen to upload in. It ends on your order, ready to review and pay for. `test/orderfile_check.py` checks the file against the rules that tool applies when it reads one.

The download also has two start files, `Start order - Windows.bat` and `Start order - Mac or Linux.command`. Double-clicking one checks that `cards.xml` is there, asks before downloading the tool's zip from its GitHub releases page into the folder, unzips it, then runs it with the browser already chosen (Chrome if it is installed, otherwise Edge on Windows), which skips the tool's opening questions. They are plain text, so anyone can open one and read exactly what it does. The Mac and Linux file was run here with a stand-in for the download. The Windows file has been run on a real computer as far as the download step (an earlier version asked for the wrong file name, which is fixed), and the Mac file not at all. If one does not work, the instructions in the download say how to start the tool by hand.

Why a helper program at all: the upload into MakePlayingCards happens on their site, under your login there, and a web page from another address is not allowed to operate it. The helper works because it runs on your computer and drives the browser from outside.

## How two decks share one set of cards

- Deck 1 is printed on the fronts and deck 2 on the backs.
- A double-faced card needs both sides of its own card, so it gets a card to itself. Those come first.
- If one deck is longer, the extra cards get a plain other side. Select a plain side to fill it: the card you pick is added to that deck's list under an "Extras" heading and lands on exactly that side.
- When one deck's commander is double-faced, the other deck's commander goes last among its single cards. With two 100-card decks that makes it the one card without a partner: the two commanders are the two cards that stand apart, and the other 99 and 99 pair up.
- You can move any card to another slot on its own side. Moves are remembered and replayed when the plan is rebuilt, so they survive new artwork and a new search.
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

Deck links are not supported. Moxfield and Archidekt do not let other websites read decks from a browser. The Paste button notices a pasted web address and asks for the list instead.

Official ready-made decks: all 178 lists in the index were converted and read back as exactly 100 cards with the right commander.

## Things it will not do silently

- A typo is reported as "not found". It is never swapped for a different card. Scryfall's forgiving search sometimes answers with an unrelated card, so its answers are only accepted when the name is a letter or two off.
- A line the card database refuses cannot take the rest of the deck with it.
- Lines read as headings are listed on the page, so a card typed without a number is not lost unnoticed.

## Fair use

This is for personal playtest cards. Do not sell what you print and do not use it in sanctioned events.

Unofficial fan tool. Not affiliated with or endorsed by Wizards of the Coast, Scryfall, MTGJSON, MakePlayingCards, MPC Autofill, Archidekt, EDHREC or Moxfield. Card images are copyright Wizards of the Coast and are loaded from Scryfall in your browser when you ask for them.

What leaves the page: the commander name you type and the card names and set codes in your lists go to Scryfall to look the cards up, building a starter deck asks Scryfall for the most played cards in the commander's colours, and choosing a ready-made deck asks MTGJSON for that one list. Nothing else is sent anywhere.

The page follows Scryfall's API rules: one batched lookup per 75 cards, at least half a second between requests (the commander search waits for a pause in typing), and it waits when asked to slow down.

## Working on it

```
npm install
npx playwright install chromium   # or set CHROME_PATH to a Chrome you already have
npm run build                     # writes docs/index.html from src/
npm test                          # logic tests, browser tests, cross-site tests
npm run precons                   # rebuild data/precons.json from MTGJSON (then build again)
```

- `src/core.js`: list reading, lookups, pairing, file names, zip, deck view groups, artwork filter, ready-made deck lists and the order file. No page code, so it is tested on its own.
- `src/app.js`: the page, the Scryfall calls and the print images.
- `data/precons.json`: which official deck each commander leads. Made by `tools/precons.mjs`, inlined into the page by the build.
- `test/mock.cjs`: a stand-in for Scryfall with made-up cards and placeholder pictures, so the tests need no network.
- `test/realnet.cjs`: runs the page through the browser's real network stack against a local server, to check what happens when a server allows or refuses a page opened from a file.
- `test/live/`: checks against the real services. `capture-archidekt.cjs` saves real exports from a public deck into `test/live/samples/` (not committed, they are someone else's deck list). `npm run test:live` then runs them through the real page. `chain-live.cjs` runs the whole chain for real: commander name, official deck, artwork filter, download and order file.

Edit files in `src/`, then run `npm run build`. Do not edit `docs/index.html` by hand.

## Credits

- Card data and scans: [Scryfall](https://scryfall.com/docs/api)
- Official deck lists: [MTGJSON](https://mtgjson.com)
- The order file format and the desktop tool that reads it: [MPC Autofill](https://github.com/chilli-axe/mpc-autofill)
- Typeface: Archivo by Omnibus-Type, SIL Open Font License 1.1
- The `front // back` list format belongs to [MPC Autofill](https://github.com/chilli-axe/mpc-autofill)
