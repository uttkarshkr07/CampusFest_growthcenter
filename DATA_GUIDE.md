# Data guide

How to change the fest's data in Excel, check it and load it into the app.

## Two datasets

The app holds two datasets side by side. The **Data** switch at the top changes which one every screen and the
copilot use.

| In the app | In commands | What it is | Folder of workbooks |
|---|---|---|---|
| Original 2025 data | `original` | The brief's data. It is meant to stay as given, so graders can test with it. | `dataset` |
| Simulated run with our bets | `simulated` | A made-up run of the fest with the bets in place. It is not real results. | `dataset/simulated` |

Each has its own tables. Edits, tasks, tickets, ticket comments, the change log, settings, **Reset** and loading
act on one dataset only. Copilot chats are listed per dataset: the history shows the chats of the dataset on
screen. The simulated choice stays switched off ("not loaded yet") until its first load.

## The workbooks

Both folders sit next to the `app` folder.

| File | What you change there |
|---|---|
| `Attendee Dataset.xlsx` | Event, targets, campaigns, daily marketing, people, interactions, registrations, status history, gate check-ins |
| `Sponsor Dataset.xlsx` | Sponsor targets, brands, contacts, campaigns, interactions, qualification history, opportunities, opportunity history, activations |
| `Operations Dataset.xlsx` | Team, assumptions (Settings), campaign budgets (Campaign plan), tickets between teams |
| `Bet Dataset.xlsx` | **Simulated only.** The program, and the records behind the bets (see below) |

Keep the sheet names and column names as they are. Extra sheets are ignored, and extra columns are not loaded
(the check warns about them on attendee sheets). The "Field guide" sheet in the two dataset workbooks explains
what each column means.

## Check, then load

From the `app` folder:

```powershell
npm run data:check                                  # checks the original's workbooks. Changes nothing.
npm run data:check -- --dataset simulated           # checks the simulated workbooks
npm run data:load -- --dataset original             # checks, asks you to type REPLACE ORIGINAL, then loads
npm run data:load -- --dataset simulated            # checks, asks you to type REPLACE SIMULATED, then loads
```

To use another folder, add `--folder "D:\some\folder"` after the `--`.

Safeguards:

- A load must name its dataset. `data:load` on its own stops.
- A folder that holds `Bet Dataset.xlsx` is never loaded as the original, and the simulated dataset needs that file.
- Checking or loading the original says which tables differ from the brief's data (the copy in `data/seed`).
- Each run prints an estimate of the database size. A load also prints the real size.

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

**A load replaces its whole dataset.** Its edits made in the app, tasks, tickets and ticket comments are cleared,
and the app shows what is in the workbooks. The other dataset is not touched. Copilot chats are kept, but older
answers quote the older figures. If a load stops halfway, the app keeps showing the old data and that dataset's
Reset is blocked: run the load again. Sponsor records are replaced as they are sent, not at the final switch.

The program for the **original** dataset (used by the campus map) is loaded separately, from
`program/CampusFest_2025_program.xlsx`. It replaces only the venue and event lists and resets nothing:

```powershell
npm run data:program                # add  -- -- --check  to read and check only
```

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

## The simulated dataset's extra data

The first three workbooks work as described above, with these additions in its `Attendee Dataset.xlsx`. All are
required columns (the cells may be empty):

| Sheet | New columns | Values |
|---|---|---|
| People | `college_id` | An ID from Colleges |
| Registrations | `route` | individual, squad, contingent |
| Registrations | `squad_id`, `contingent_id` | IDs from Squads and Contingents |
| Registrations | `test_name`, `test_arm` | empty, two_step or squad_offer; empty, treatment or control |

Set `event_ends_at` to 13 April 23:00, or the second night's scans are not counted.

### Bet Dataset.xlsx

All 21 sheets are needed. A sheet may have only its header row. Column names must match exactly. In these tables,
columns ending `_on` are dates and columns ending `_at` are India times. Yes/no columns take yes, no, true or false.
Money is in INR. Meanings are in `strategy/tracking_spec.md`.

| Sheet | Columns (the first one, and any marked *, must be filled) | Fixed words |
|---|---|---|
| Colleges | `college_id`, `college_name`, `college_type`, `cluster`, `visited_on`, `signed_on`, `od_letter_on`, `outreach_wave`, `owner_id` | type: du, ggsipu, ncr_other, health, outstation. wave: A, B |
| Contingents | `contingent_id`, `college_id`, `head_person_id`, `registered_at` | |
| Contingent tiers | `tier_event_id`, `contingent_id`, `milestone`, `reached_at`, `discounted_slots` | 50 with 10 slots, 100 with 15, 150 with 20 |
| Squads | `squad_id`, `created_at`, `leader_person_id` | |
| Passes | `pass_id`, `registration_id`, `person_id`, `pass_type`, `price_plan`, `price_inr`, `discount_type`, `discount_inr`, `booked_at`, `booking_amount_inr`, `locked_in_at`, `lock_amount_inr`, `id_verified_at`, `hostel_name`, `cancelled_at`, `cancel_reason`, `qr_voided_at` | pass_type: normal, accommodation. price_plan: two_step, single, gate. discount: none, contingent_25. cancel_reason: normal, exam_clash, not_locked |
| Payments | `payment_id`, `pass_id`, `kind`, `amount_inr`, `paid_at` | booking, lock, full, gate, refund_resale, refund_exam, squad_cashback, wallet_credit |
| Perks | `grant_id`, `pass_id`, `perk`, `granted_at`, `collected_at`, `cost_inr` | wristband, wallet_100, wallet_50, window_1, window_2 |
| Insurance claims | `claim_id`, `pass_id`, `filed_at`, `proof_type`, `decision`, `decided_at`, `refund_inr` | proof: datesheet, college_letter. decision: pending, approved, rejected |
| Venues | `venue_id`, `venue_name`, `venue_type`, `capacity`, `seated`, `map_x`, `map_y`, `notes` | empty capacity means no limit |
| Program events | `event_id`, `event_name`, `brand_name`, `cup`, `scored`, `points`, `kind`, `starts_at`, `ends_at`, `venue_id`, `booking_required`, `seats_offered`, `audience`, `sponsor`, `notes` | |
| Seat bookings | `history_id`, `booking_id`*, `event_id`, `person_id`, `pass_id`, `effective_at`, `status` | booked, cancelled, released. A history: add a row for each change |
| Seat scans | `scan_id`, `event_id`, `person_id`, `occurred_at`, `result`, `deny_reason` | result: admitted, denied. reason: empty, full, no_booking, invalid |
| Waitlist | `entry_id`, `kind`, `event_id`, `person_id`, `joined_at`, `left_at` | show_seat, pass |
| Exchange offers | `offer_id`, `kind`, `event_id`, `entry_id`, `source_booking_id`, `source_pass_id`, `offered_at`, `expires_at`, `claimed_at`, `expired_at`, `new_booking_id`, `new_pass_id` | show_seat, pass |
| Competition results | `result_id`, `event_id`, `college_id`, `team_name`, `position`, `points`, `recorded_at` | position 1 to 5; points with ties already split |
| Hackathon teams | `team_id`, `team_name`, `college_id`, `registered_at`, `status` | registered, withdrawn |
| Hackathon members | `team_id`, `person_id`* | |
| Bets | `bet_id`, `rank`, `bet_name`, `owner_team`, `budget_inr`, `planned_increment_base`, `planned_increment_stretch`, `simulation_note` | bet_id: B1 to B5. team: publicity, sponsorship, events |
| Bet thresholds | `threshold_id`, `kpi_id`*, `bet_id`, `check_on`, `direction`, `scale_at`, `stop_at`, `min_sample`, `action_scale`, `action_change`, `action_stop` | higher, lower. empty bet_id means the whole plan |
| Bet milestones | `milestone_id`, `bet_id`*, `milestone`, `due_on`, `done_on` | |
| Bet spend | `spend_id`, `bet_id`*, `spent_on`, `amount_inr`, `item` | |

The program sheets may keep an extra `day` column (it is not loaded). Venue and artist names in the program are an
illustrative lineup: attach no simulated problem, quote, cancellation or money to a named real person or company.

A missing sheet, column or ID stops the load. Everything else **loads as written**, because planned problems such as
an overbooked show must be able to reach the app. The report lists:

- unknown fixed words, and IDs that point to no record;
- one ID with two different rows (the last row wins);
- more than 5 people in a squad; squad cashback without 5 members who passed the gate during the fest;
- more than 13,000 external passes valid at the same time;
- a pass locked in or cancelled before it was booked;
- more bookings for a session than its `seats_offered`; more seats offered than the venue holds;
- an event that ends before it starts;
- an offer window that is not 10 minutes; an offer both claimed and expired, or claimed late;
- a contingent tier with the wrong slots; a position outside 1 to 5; more points than the event is worth.

In the app these tables are view only, except bet thresholds, which the publicity team and the Reviewer can change
in the database. No screen or copilot answer uses them yet.

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

Estimates for the simulated dataset at 20,000 registrations (not measured): about 197,000 attendee rows and 124,000
rows in the new tables; about 215 MB of database for both datasets, about 305 MB while a load or reset is switching
over; a first download of at most 8 MB. If space runs short, lower the interaction rows per person first (the
largest table), not the number of registrations.

## Privacy

Use made-up names only. The repository is public, every demo account can read all records, and questions,
summaries, ticket text and tool results are sent to Google's free Gemini model.

## For developers

`data/seed` holds the first dataset. The automated tests check calculations against it, so do not edit it.
The workbooks are not copied into the repository.

The bet table columns are listed in `lib/data/bet-spec.ts`, `supabase/patch_session4_datasets.sql` and the converter
`scripts/dataset_to_json.py`; tests keep the three in step. `lib/datasets.ts` is the only place that knows the `sim_`
prefix. The `sim_` database functions are copies of the original ones: after changing one, change both
(`tests/sql_drift.test.ts` checks this).
