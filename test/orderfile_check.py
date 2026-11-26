"""Checks cards.xml the way the MPC Autofill desktop tool reads an order file.

The rules below mirror desktop-tool/src/order.py in github.com/chilli-axe/mpc-autofill as read on 2026-11-26:
the id of a "Local File" card is a path, looked up from the folder the tool runs in; it must be a file that
is not empty; slots are comma-separated numbers counting from zero; a face must have at least one picture;
slots that <backs> leaves empty are filled with <cardback>; the stock must be one the tool knows.

Usage: python3 -I test/orderfile_check.py <unzipped download folder>
Prints a JSON summary. Exits with status 1 and lists the problems when something is wrong."""
import json
import os
import sys
from xml.etree import ElementTree

STOCKS = ["(S27) Smooth", "(S30) Standard Smooth", "(S33) Superior Smooth", "(M31) Linen", "(P10) Plastic"]
PROJECT_MAX_SIZE = 612


def text_to_set(text):
    if not text:
        return set()
    return set(int(x) for x in text.strip("][").replace(" ", "").split(","))


def is_file(path):
    return bool(path) and os.path.isfile(path) and os.path.getsize(path) > 0


def read_face(element, quantity, fill, problems, label):
    by_slot = {}
    for card in (element if element is not None else []):
        fields = {child.tag: child.text for child in card}
        path = (fields.get("id") or "").strip(' "')
        if fields.get("sourceType") != "Local File":
            problems.append("%s: %s is not marked as a local file" % (label, path))
        if not is_file(path):
            problems.append("%s: no such picture in the folder: %s" % (label, path))
        slots = text_to_set(fields.get("slots"))
        if not slots:
            problems.append("%s: %s has no card slot" % (label, path))
        for slot in slots:
            if slot < 0 or slot >= quantity:
                problems.append("%s: slot %d is outside the order (%s)" % (label, slot, path))
            if slot in by_slot:
                problems.append("%s: slot %d is given two pictures" % (label, slot))
            by_slot[slot] = path
    missing = sorted(set(range(quantity)) - set(by_slot))
    if missing and fill:
        if not is_file(fill):
            problems.append("%s: the shared picture is not in the folder: %s" % (label, fill))
        for slot in missing:
            by_slot[slot] = fill
        missing = []
    if not by_slot:
        problems.append("%s has no images" % label)
    if missing:
        problems.append("%s: these slots are empty: %s" % (label, missing))
    return by_slot


def main(folder):
    os.chdir(folder)
    problems = []
    root = ElementTree.parse("cards.xml").getroot()
    if root.tag != "order":
        problems.append("the top element is not <order>")
    parts = {child.tag: child for child in root}
    details = {child.tag: child.text for child in parts.get("details", [])}
    quantity = int(details.get("quantity") or 0)
    stock = details.get("stock") or STOCKS[1]
    if quantity < 1 or quantity > PROJECT_MAX_SIZE:
        problems.append("quantity %d does not fit one project" % quantity)
    if stock not in STOCKS:
        problems.append("card stock not supported: %s" % stock)
    cardback = parts["cardback"].text.strip(' "') if "cardback" in parts and parts["cardback"].text else None
    fronts = read_face(parts.get("fronts"), quantity, None, problems, "fronts")
    backs = read_face(parts.get("backs"), quantity, cardback, problems, "backs")
    summary = {
        "quantity": quantity,
        "stock": stock,
        "foil": details.get("foil") == "true",
        "cardback": cardback,
        "fronts": [fronts.get(i) for i in range(quantity)],
        "backs": [backs.get(i) for i in range(quantity)],
        "problems": problems,
    }
    print(json.dumps(summary))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
