"""Checks every card file in extension/cards against card.schema.json and a few extra rules.

Run from the repository folder:  python3 tools/check_cards.py
Needs the package "jsonschema" (pip install jsonschema).
Prints every problem it finds and exits with an error if there is at least one.
"""
import json
import pathlib
import sys

from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "card.schema.json").read_text(encoding="utf-8"))
CARD_DIR = ROOT / "extension" / "cards"
PREFIX = {"computer_science": "cs", "mathematics": "ma", "economics": "ec", "psychology": "ps"}


def main() -> int:
    Draft202012Validator.check_schema(SCHEMA)
    validator = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
    problems = []
    seen_ids = {}
    total = 0

    files = sorted(CARD_DIR.glob("*.json"))
    if not files:
        problems.append(f"No card files found in {CARD_DIR}")

    for path in files:
        name = path.relative_to(ROOT)
        subject = path.stem
        if subject not in PREFIX:
            problems.append(f"{name}: file name must be one of {', '.join(PREFIX)}")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            problems.append(f"{name}: not valid JSON ({err})")
            continue

        for err in validator.iter_errors(data):
            where = "/".join(str(p) for p in err.absolute_path)
            problems.append(f"{name} [{where}]: {err.message}")

        for i, card in enumerate(data.get("cards", [])):
            total += 1
            cid = card.get("id", f"#{i}")
            if card.get("subject") != subject:
                problems.append(f"{name} {cid}: subject is '{card.get('subject')}', but the file is {subject}")
            if isinstance(cid, str) and not cid.startswith(PREFIX[subject] + "-"):
                problems.append(f"{name} {cid}: id must start with '{PREFIX[subject]}-'")
            if isinstance(cid, str) and isinstance(card.get("chapter"), int):
                parts = cid.split("-")
                if len(parts) == 3 and parts[1].isdigit() and int(parts[1]) != card["chapter"]:
                    problems.append(f"{name} {cid}: id says chapter {int(parts[1])}, card says {card['chapter']}")
            if cid in seen_ids:
                problems.append(f"{name} {cid}: id already used in {seen_ids[cid]}")
            seen_ids[cid] = name

            kind = card.get("type")
            if kind == "find_error" and isinstance(card.get("lines"), list):
                if not 1 <= card.get("error_line", 0) <= len(card["lines"]):
                    problems.append(f"{name} {cid}: error_line points outside the {len(card['lines'])} lines")
            if kind == "cloze" and isinstance(card.get("options"), list):
                if len(set(card["options"])) != len(card["options"]):
                    problems.append(f"{name} {cid}: the two options are the same")
            if kind == "estimate" and isinstance(card.get("estimate"), dict):
                e = card["estimate"]
                if all(isinstance(e.get(k), (int, float)) for k in ("min", "max", "correct")):
                    if not e["min"] <= e["correct"] <= e["max"]:
                        problems.append(f"{name} {cid}: correct value is outside the slider range")
            link = card.get("notes_link")
            if link is not None and not str(link).startswith("https://"):
                problems.append(f"{name} {cid}: notes_link must start with https://")

    for p in problems:
        print("PROBLEM:", p)
    print(f"{total} cards in {len(files)} files checked, {len(problems)} problems.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
