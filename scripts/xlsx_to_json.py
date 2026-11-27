"""Convert the CampusFest xlsx sources into seed JSON (one file per table).

Run from the app folder with an isolated interpreter:
    python -I scripts/xlsx_to_json.py
Excel datetimes are naive IST, so they are emitted as ISO strings with +05:30.
Raw rows are kept INCLUDING duplicate IDs: deduplication is the engine's job.
"""
import datetime as dt
import json
import os
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "seed")
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")
ATTENDEE = os.environ.get("ATTENDEE_XLSX", os.path.join(DOWNLOADS, "Attendee Dataset.xlsx"))
SPONSOR = os.environ.get("SPONSOR_XLSX", os.path.join(DOWNLOADS, "Sponsor Dataset.xlsx"))

ATTENDEE_SHEETS = {
    "Event": "event",
    "Targets": "targets",
    "Campaigns": "campaigns",
    "Daily Marketing": "daily_marketing",
    "People": "people",
    "Interest and Engagement": "interactions",
    "Registrations": "registrations",
    "Registration History": "registration_history",
    "Check-ins": "checkins",
}
# The full sponsor records are one file, data/seed/sponsor.json.
SPONSOR_SHEETS = {
    "Targets": "targets",
    "Brands": "brands",
    "Sponsor contacts": "contacts",
    "Sponsor campaigns": "campaigns",
    "Sponsor interactions": "interactions",
    "Brand qualification": "qualification",
    "Partner opportunities": "opportunities",
    "Opportunity history": "opportunity_history",
    "Sponsor activations": "activations",
}
DATE_ONLY = {"activity_date", "history_start", "history_end"}


def conv(field, v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if isinstance(v, bool):
        return v
    if isinstance(v, dt.datetime):
        if field in DATE_ONLY:
            return v.strftime("%Y-%m-%d")
        return v.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    if isinstance(v, dt.date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def sheet_rows(wb, name):
    it = wb[name].iter_rows(values_only=True)
    header = [str(h).strip() for h in next(it) if h is not None]
    rows = []
    for r in it:
        if r is None or all(c is None or (isinstance(c, str) and not c.strip()) for c in r):
            continue
        rows.append({h: conv(h, r[i] if i < len(r) else None) for i, h in enumerate(header)})
    return rows


def write(table, rows):
    with open(os.path.join(OUT, table + ".json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{table:24s} {len(rows):6d} rows")


def main():
    os.makedirs(OUT, exist_ok=True)
    wb = openpyxl.load_workbook(ATTENDEE, read_only=True, data_only=True)
    for sheet, table in ATTENDEE_SHEETS.items():
        write(table, sheet_rows(wb, sheet))
    swb = openpyxl.load_workbook(SPONSOR, read_only=True, data_only=True)
    write("sponsor_activations", sheet_rows(swb, "Sponsor activations"))
    sponsor = {key: sheet_rows(swb, sheet) for sheet, key in SPONSOR_SHEETS.items()}
    with open(os.path.join(OUT, "sponsor.json"), "w", encoding="utf-8") as f:
        json.dump(sponsor, f, ensure_ascii=False, separators=(",", ":"))
    for key, rows in sponsor.items():
        print(f"sponsor {key:20s} {len(rows):6d} rows")


if __name__ == "__main__":
    sys.exit(main())
