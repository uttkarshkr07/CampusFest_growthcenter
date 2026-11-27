# Data guide

How to change the fest's data in Excel, check it and load it into the app.

## The three workbooks

They live in the `dataset` folder next to the `app` folder.

| File | What you change there |
|---|---|
| `Attendee Dataset.xlsx` | Event, targets, campaigns, daily marketing, people, interactions, registrations, status history, gate check-ins |
| `Sponsor Dataset.xlsx` | Sponsor targets, brands, contacts, campaigns, interactions, qualification history, opportunities, opportunity history, activations |
| `Operations Dataset.xlsx` | Team, assumptions (Settings), campaign budgets (Campaign plan), tickets between teams |

Keep the sheet names and column names as they are. Extra sheets are ignored, and extra columns are not loaded
(the check warns about them on attendee sheets). The "Field guide" sheet in the two dataset workbooks explains
what each column means.

## Check, then load

From the `app` folder:

```powershell
npm run data:check     # reads the files and reports problems. Changes nothing.
npm run data:load      # checks, asks you to type REPLACE, then replaces the live data
```

To use another folder: `npm run data:check -- --folder "D:\some\folder"`.

Every run writes `check-report.csv` into the dataset folder: one line per problem record, with its Excel row.
Close it in Excel before the next run.

| In the report | Meaning |
|---|---|
| MUST FIX | The database or the app cannot take it. Nothing is loaded until it is fixed. |
| warning | It loads. Read it, because something may not behave as you expect. |
| excluded | The record loads but is left out of the figures. |
| check | The record is counted as written. Make sure that is what you meant. |
| read_as | Capital letters or extra spaces were ignored. |
| info | Expected by the rules, for example an exact copy. |

**A load replaces everything.** Edits made in the app, tasks, tickets and ticket comments are cleared, and the
app shows what is in the workbooks. Copilot chats are kept, but older answers quote the older figures.
If a load stops halfway, the app keeps showing the old data and Reset is blocked: run the load again.

## Rules that apply to every sheet

- **Dates and times** are India time. Use real Excel dates, or text written as `2025-04-12` or `2025-04-12 10:00`.
  Other text (for example `12/04/2025` or `TBD`) cannot be read.
- **IDs** link the sheets. Names beside IDs are for reading; the app goes by the ID and reports names that differ.
- **Repeated IDs:** identical rows count once. If an ID repeats with different contents, the **last** row wins.
- **Histories** (registration status, qualification, opportunity stage) are full versions. To change a status, add
  a new row with a later time. Never add versions together.
- **Fixed words:** capital letters and outer spaces are ignored. Any other unknown word is never guessed.
- **A selected date** means the end of that day. Nothing later is shown to the copilot.

## What stops a load

- A missing file, sheet or column.
- An empty ID (`campaign_id`, `activity_id`, `person_id`, `interaction_id`, `registration_id`, `history_id`,
  check-in `event_id`, `activation_id`).
- Not exactly one row in **Event**, or its four dates unreadable or out of order
  (`history_start` <= event start < event end <= `history_end`).
- A target with no readable `effective_at`, or a marketing row with no readable `activity_date`.
- A ticket, team, setting or campaign plan row that breaks the rules further down.

Any other unreadable date or number **loads as empty**, with a warning.

## Counting rules

| Situation | What the app does |
|---|---|
| Actual attendee | An external person with at least one scan that is admitted **and** verified, made between the event's start and end. Walk-ins count. |
| Scan before the start, after the end, or with no readable time | Not counted, and listed. If gates really open earlier, change `event_starts_at`. The window runs from start to end without a break, including nights. |
| Internal, staff or test person admitted | Not counted. |
| `ADMITTED`, ` Verified ` | Read as `admitted`, `verified`, and listed. |
| Unknown word such as `entered` or `attended` | Does not count wherever it matters, and listed. |
| Row pointing to a person, campaign, registration or brand that does not exist | Never matched by guessing, and listed. |
| Interaction, registration or status row with no readable time | Left out of dated figures, and listed. |
| Negative spend | A vendor credit that reduces spend. A campaign whose total goes below zero is flagged. |
| One person with two registrations | Counted once, under the earliest. |

Allowed words:

| Column | Values |
|---|---|
| `person_type` | external, internal, staff, test |
| check-in `result` | admitted, denied, pending |
| check-in `verification` | verified, unverified |
| check-in `source` | scanner, manual |
| registration `status` | interested, confirmed, cancelled, waitlisted |
| `qualification_status` | unreviewed, engaged, qualified, unqualified, dormant |
| opportunity `stage` | prospecting, contacted, proposal_sent, negotiating, partner_confirmed, lost, withdrawn |
| `support_type` | cash, in_kind |
| sponsor `event_type` | outreach_sent, delivered, replied, meeting_booked, meeting_held, opt_out, introduction_received, web_inbound |

Attendee interaction `event_type` accepts new words. Two are used by the calculations:
`event_question_submitted` (counts as engaged) and `opted_out`.

Sponsor records are stored as written, so only their columns are checked before loading. Their problems appear in
the report and on the app's Data quality tab.

## Operations workbook

### Team
`owner_id` (unique), `owner_name`, `team` (publicity, sponsorship or events). Use the same `owner_id` values in
the dataset sheets. Sign-in accounts are a fixed list in `lib/auth/accounts.json`: a new organiser needs an entry
there, then `node scripts/setup_logins.mjs`. The check warns when the two lists differ.

### Settings
One value per `key`. All are assumptions. `walkin_assumption` is a **count**, so raise it for a bigger fest.
`story_today` is optional: the date the "Today in story" button selects. Left empty, it is the last target change
before the event.

### Campaign plan
Optional, one row per campaign: `app_status` (planned, active, paused, stopped; empty means active),
`budget_inr`, `notes`.

### Tickets
One row per ticket.

| Column | Rule |
|---|---|
| `ticket_key` | Unique, for example TK002. Keep it unchanged so links to the ticket keep working. TK001 is the sample ticket. |
| `title` | 1 to 140 characters |
| `details` | Up to 4,000 characters. Alt+Enter makes a new line. |
| `from_team`, `to_team` | publicity, sponsorship or events, and different from each other |
| `requester_id`, `assignee_id` | Optional owner IDs from Team |
| `priority` | low, medium, high (empty means medium) |
| `raised_on` | Required. The ticket is invisible before this date. |
| `needed_by` | Optional, on or after `raised_on`. Overdue is worked out from it. |
| `accepted_on` or `declined_on` | At most one of the two, on or after `raised_on` |
| `decline_reason` | Optional, with `declined_on` |
| `started_on` | Needs `accepted_on`, on or after it |
| `done_on` | Needs `started_on`, on or after it |
| `simulation_note` | Warning text for a made-up scenario. It is shown wherever the ticket appears or is quoted. |

The status at any date follows from these dates. There is no reopen, reassign or cancel. For a reopened request,
add a second ticket that refers to the first. Comments are added in the app, not in Excel.

## Real-life situations you can build in

| Situation | How to put it in the data |
|---|---|
| Gate scanner went offline | Scans with `source` = manual, or a gap in scan times |
| Fake or duplicate entry attempts | Several denied or unverified scans for one person |
| Volunteers testing the gate before opening | Admitted scans before the event start (excluded and listed) |
| Last-minute cancellations | A later status version `cancelled` |
| Capacity waitlist | Status `waitlisted`, then `confirmed` later |
| Vendor refund | A negative spend row |
| Campaign paused after poor results | No further daily rows, plus `app_status` = paused |
| Targets revised midway | A new Targets row with a later `effective_at` |
| Import retried | An exact copy of a row |
| Sponsor pulls out | A later opportunity version `withdrawn` |
| Request ignored | A ticket with `needed_by` passed and no further dates |
| Request refused | `declined_on` with a `decline_reason` |

## Size

The target is about 20,000 actual attendees, roughly ten times the first dataset (about 275,000 attendee rows).

| Tested at about 10 times | Result |
|---|---|
| `npm run data:check` | About 1 minute on the build computer |
| Figures in the browser | About 1 to 2 seconds for the first calculation of a date |
| Loading into the database, and opening the app on it | **Not tested yet.** The first real load is the test. |

The free database holds 500 MB and allows 5 GB of downloads a month. The load command prints the database size.
The browser keeps a copy of the large tables and downloads one again only after it changes. Free Supabase
projects are paused after a week without use.

## Privacy

Use made-up names only. The repository is public, every demo account can read all records, and questions,
summaries, ticket text and tool results are sent to Google's free Gemini model.

## For developers

`data/seed` holds the first dataset. The automated tests check calculations against it, so do not edit it.
The new workbooks are not copied into the repository.
