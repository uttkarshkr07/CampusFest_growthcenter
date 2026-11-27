"""Reads the three dataset workbooks and writes one JSON file for the check and load command.

    python -I scripts/dataset_to_json.py <folder with the workbooks> <output .json>

It only reads and converts. Every row keeps its Excel row number (__row) so problems can be found.
Dates: Excel dates, and text like 2025-04-12 10:00, are taken as India time (+05:30). Text that is
not written that way is passed through unchanged, and the checks report it.
"""
import datetime as dt
import json
import os
import re
import sys

import openpyxl

WORKBOOKS = {
    "attendee": ("Attendee Dataset.xlsx", {
        "event": "Event",
        "targets": "Targets",
        "campaigns": "Campaigns",
        "daily_marketing": "Daily Marketing",
        "people": "People",
        "interactions": "Interest and Engagement",
        "registrations": "Registrations",
        "registration_history": "Registration History",
        "checkins": "Check-ins",
    }),
    "sponsor": ("Sponsor Dataset.xlsx", {
        "targets": "Targets",
        "brands": "Brands",
        "contacts": "Sponsor contacts",
        "campaigns": "Sponsor campaigns",
        "interactions": "Sponsor interactions",
        "qualification": "Brand qualification",
        "opportunities": "Partner opportunities",
        "opportunity_history": "Opportunity history",
        "activations": "Sponsor activations",
    }),
    "ops": ("Operations Dataset.xlsx", {
        "team": "Team",
        "settings": "Settings",
        "campaign_plan": "Campaign plan",
        "tickets": "Tickets",
    }),
}
DATETIME = {"effective_at", "created_at", "planned_start_at", "planned_end_at", "first_seen_at", "occurred_at",
            "registered_at", "linked_at", "event_starts_at", "event_ends_at"}
DATE = {"activity_date", "history_start", "history_end", "raised_on", "needed_by", "accepted_on", "declined_on",
        "started_on", "done_on"}
WRITTEN = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|[+-]\d{2}:?\d{2})?$")


def convert(field, v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip() if field != "details" else v.replace("\r\n", "\n").strip()
        # capital letters and spaces in fixed words are left for the checks to report
        if v == "":
            return None
        m = WRITTEN.match(v)
        if m and field in DATE:
            return m.group(1)
        if m and field in DATETIME:
            day, clock, zone = m.groups()
            clock = clock or "00:00:00"
            if len(clock.split(":")[0]) == 1:
                clock = "0" + clock
            if clock.count(":") == 1:
                clock += ":00"
            return f"{day}T{clock}{zone or '+05:30'}"
        return v
    if isinstance(v, bool):
        return v
    if isinstance(v, dt.datetime):
        if field in DATE:
            return v.strftime("%Y-%m-%d")
        return v.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    if isinstance(v, dt.date):
        return v.strftime("%Y-%m-%d") if field in DATE else v.strftime("%Y-%m-%dT00:00:00+05:30")
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, (int, float)):
        return v
    return str(v)


def read_rows(ws, keep_spaces):
    it = ws.iter_rows(values_only=True)
    head = next(it, None) or ()
    header = [(i, str(h).strip()) for i, h in enumerate(head) if h is not None and str(h).strip()]
    rows = []
    for number, r in enumerate(it, start=2):
        if r is None or all(c is None or (isinstance(c, str) and not c.strip()) for c in r):
            continue
        row = {"__row": number}
        for i, name in header:
            raw = r[i] if i < len(r) else None
            # fixed words keep their spaces and capitals, so the checks can report them
            row[name] = raw if (name in keep_spaces and isinstance(raw, str) and raw.strip()) else convert(name, raw)
        rows.append(row)
    return [name for _, name in header], rows


FIXED_WORDS = {"person_type", "result", "verification", "source", "status", "event_type", "outcome",
               "qualification_status", "stage", "support_type"}


def main(folder, out_path):
    out = {"headers": {}, "problems": []}
    for group, (file_name, sheets) in WORKBOOKS.items():
        out[group] = {}
        path = os.path.join(folder, file_name)
        if not os.path.exists(path):
            out["problems"].append({"sheet": file_name, "text": f"The file is missing from {folder}"})
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for key, sheet in sheets.items():
            if sheet not in wb.sheetnames:
                out["problems"].append({"sheet": f"{file_name} / {sheet}", "text": "The sheet is missing"})
                continue
            header, rows = read_rows(wb[sheet], FIXED_WORDS if group != "ops" else set())
            out["headers"][f"{group}.{key}"] = header
            out[group][key] = rows
        wb.close()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
