"""Pull the text of the rulebook pages that the Event List uses, one block per page.

Usage: python -I scripts/rulebook_extract.py <rulebook.pdf> <out.txt> [pages...]
The PDF is not in the repo. The output is raw text; lib/data/events.json holds the adapted rules
(CampusFest name and dates, no Spring Fest emails or IDs), written by hand from it.
"""
import sys

import fitz  # PyMuPDF

PAGES = [2, 4, 5, 6, 8, 10, 11, 12, 13, 14, 18, 20, 22, 24, 28, 32, 33, 36, 39, 43, 44, 46, 48, 50]


def main() -> None:
    pdf, out = sys.argv[1], sys.argv[2]
    pages = [int(p) for p in sys.argv[3:]] or PAGES
    doc = fitz.open(pdf)
    with open(out, "w", encoding="utf-8") as f:
        for p in pages:
            text = doc[p - 1].get_text()
            # pages repeat their title; keep the text as is, the adapting is done by hand
            f.write(f"===== page {p} =====\n{text.strip()}\n\n")
    print(f"wrote {len(pages)} pages to {out}")


if __name__ == "__main__":
    main()
