"""Writes "Operations Dataset.xlsx", pre-filled with what the app has today.

    python -I scripts/make_operations_template.py <folder>

It never overwrites an existing file.
"""
import datetime as dt
import os
import re
import sys

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
TEAMS = "publicity,sponsorship,events"
D = lambda s: dt.date.fromisoformat(s)


def sample_ticket_text():
    sql = open(os.path.join(HERE, "..", "supabase", "patch_session3e_scale.sql"), encoding="utf-8").read()
    return re.search(r"\$text\$(.*?)\$text\$", sql, re.S).group(1).replace("\r\n", "\n")


def sheet(wb, title, header, rows, widths, lists=None, date_columns=()):
    ws = wb.create_sheet(title)
    ws.append(header)
    for row in rows:
        ws.append(row)
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = width
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="EDF2FF")
    ws.freeze_panes = "B2"
    for column, choices in (lists or {}).items():
        letter = openpyxl.utils.get_column_letter(header.index(column) + 1)
        rule = DataValidation(type="list", formula1=f'"{choices}"', allow_blank=True)
        rule.add(f"{letter}2:{letter}5000")
        ws.add_data_validation(rule)
    for column in date_columns:
        letter = openpyxl.utils.get_column_letter(header.index(column) + 1)
        for n in range(2, 1001):
            ws[f"{letter}{n}"].number_format = "yyyy-mm-dd"
    for row in ws.iter_rows(min_row=2, max_row=len(rows) + 1):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    return ws


def main(folder):
    path = os.path.join(folder, "Operations Dataset.xlsx")
    if os.path.exists(path):
        sys.exit(f"{path} already exists. It was not changed.")
    wb = openpyxl.Workbook()
    about = wb.active
    about.title = "Read me"
    for line in [
        ["What this workbook is", "The app's own records: the team, assumptions, campaign budgets and tickets between teams. 'Reset demo data' restores what is loaded from here."],
        ["How to check and load", "From the app folder: npm run data:check, then npm run data:load. Full column guide: DATA_GUIDE.md."],
        ["Dates", "Type real dates, or text as 2025-04-12. All dates are India dates."],
        ["Tickets", "One row per ticket. Leave the later dates empty for what has not happened. started_on needs accepted_on; done_on needs started_on; a declined ticket has no accepted_on."],
        ["Made-up scenarios", "Put the warning text in simulation_note. The app shows it wherever the ticket appears or is quoted."],
        ["Privacy", "Use made-up names only. Ticket text can be sent to the AI model, and every demo account can read it."],
    ]:
        about.append(line)
    about.column_dimensions["A"].width = 24
    about.column_dimensions["B"].width = 110
    for row in about.iter_rows():
        row[0].font = Font(bold=True)
        row[1].alignment = Alignment(wrap_text=True, vertical="top")

    sheet(wb, "Team", ["owner_id", "owner_name", "team"], [
        ["T01", "Riya Kapoor", "sponsorship"], ["T02", "Kabir Shah", "sponsorship"], ["T03", "Meera Iyer", "publicity"],
        ["T04", "Arjun Verma", "publicity"], ["T05", "Nisha Rao", "publicity"], ["T06", "Dev Malhotra", "events"],
    ], [12, 24, 16], {"team": TEAMS})
    sheet(wb, "Settings", ["key", "value", "meaning"], [
        ["showup_low", 0.65, "Share of confirmed registrants who attend, low case (0 to 1)"],
        ["showup_mid", 0.75, "Same, middle case"],
        ["showup_high", 0.85, "Same, high case"],
        ["walkin_assumption", 100, "Expected walk-ins, a count. Raise it for a bigger fest."],
        ["scale_cost_ratio", 0.8, "Flag 'scale' when cost per outcome is at or below this multiple of the average"],
        ["stop_cost_ratio", 1.5, "Flag 'stop' when it is at or above this multiple"],
        ["scale_min_showup", 0.75, "Show-up needed to flag 'scale' (0 to 1)"],
        ["stop_max_showup", 0.55, "Show-up below this flags 'stop' (0 to 1)"],
        ["min_sample", 30, "Smallest group that gets a flag"],
        ["whatif_penalty_base", 2, "What-if, cautious case: added money buys results at this multiple of the average cost"],
        ["whatif_penalty_stretch", 1.5, "What-if, optimistic case: the same, a smaller multiple"],
        ["story_today", None, "Optional date for the 'Today in story' button. Empty: the last plan change before the event."],
    ], [22, 14, 90])
    sheet(wb, "Campaign plan", ["campaign_id", "app_status", "budget_inr", "notes"], [], [14, 14, 14, 60],
          {"app_status": "planned,active,paused,stopped"})
    header = ["ticket_key", "title", "details", "from_team", "to_team", "requester_id", "assignee_id", "priority",
              "raised_on", "needed_by", "accepted_on", "declined_on", "decline_reason", "started_on", "done_on", "simulation_note"]
    sheet(wb, "Tickets", header, [[
        "TK001", "RISA Labs on board for an AI x Health Hackathon: publicity needed", sample_ticket_text(), "sponsorship", "publicity",
        "T01", "T03", "high", D("2025-03-15"), D("2025-03-22"), None, None, None, None, None,
        "SIMULATED SCENARIO: RISA Labs has not agreed to this.",
    ]], [11, 40, 70, 13, 13, 13, 13, 10, 12, 12, 12, 12, 24, 12, 12, 34],
        {"from_team": TEAMS, "to_team": TEAMS, "priority": "low,medium,high"},
        ("raised_on", "needed_by", "accepted_on", "declined_on", "started_on", "done_on"))
    wb.save(path)
    print(f"Written: {path}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
