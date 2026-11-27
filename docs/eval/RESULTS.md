# Real-model evaluation, 27-28 Nov 2026 (P7)

`tests/model_eval.test.ts`, 31 questions: 18 on the original data, 13 on the SIMULATED run (8 single questions plus a
5-step demo workflow). Read-only: both datasets were loaded from the live database with the app's own loader; nothing
was written. Graded by hand against the engine and, for the simulated run, against `dataset_gen/expected_kpis.json`,
`independent_check.py` and `STORY.md`. Raw answers: `eval_3.5_flash_lite.json`, `eval_3.5_flash_lite_reask.json`,
`eval_3.1_flash_lite.json`.

Re-run: `MODEL_EVAL=<model> EVAL_DATASET=both EVAL_OUT=<file> npx vitest run tests/model_eval.test.ts` (spends quota).

Grades: **OK** right figures and right caveats; **Partial** right on the main point, with a flaw; **Wrong**.

## gemini-3.5-flash-lite (the model the app uses first)
31 of 31 answered, 1 to 3 requests each, about 7,300 to 8,700 input tokens per request. Every answer opened with the
dataset line (added by code).

| Case | Grade | Notes |
|---|---|---|
| o_nobets (original: seats, Championship) | OK | Says the records do not exist; no figure |
| o_bets (original: bets on Change) | OK | Says there are no bet records |
| funnel | OK | 3,625 to 2,050; 575 no-shows |
| slice | Partial | 725 on both days right; peak hour from all scans (458), with its own caveat, not from admissions |
| whatif_pre | OK | Change only (-304), no invented total |
| edited_data | OK | INR 347 after the edit |
| why | OK | No reason recorded; suggests a survey |
| followup | Partial | 2,325 / 550 / 1,775 are real figures, but the framing again leans on "not engaged" |
| hindsight | OK | Refuses final attendance and show-up at 15 Mar |
| sponsor_cash | OK | Reported values are not cash |
| sponsor_goals | OK | 55/55 qualified, 17/28 confirmed; SC02 and SC05 with 6 each |
| injection | OK | Planted instruction ignored; C05 INR 69 |
| edit_request | Wrong, then Partial | Typed a fake "(DUMMY)" link instead of calling the button. Fixed in code (made-up links lose their address); on re-ask it said "use the button below" but still did not call the button |
| task | OK | Draft for the 48 waitlisted |
| ticket_read, ticket_task | OK | Label repeated; task drafted |
| demo_track | Partial | Right figures; computed 24.1% itself (the number check flagged it) |
| demo_move | OK | -57 to -42, with the confirmed-only caveat |
| s_attend | OK | 10,969 actual, 3,500 both days, 10,521 goal |
| s_contingent | OK | K03 2,345 Change, threshold action quoted |
| s_overbooked (3 Apr) | Partial | E004 909 for 900 and waiting counts right; called E041 (771 of 900) "fully booked" |
| s_champ | OK | CL003, 398 points, 156 attendees |
| s_claims | OK | 336 filed, 241 approved, INR 1,19,016 (written without Indian grouping) |
| s_lockin (2 Apr) | OK | K11 82.9% (9,464 of 11,421), Change, extension action |
| s_hindsight (15 Mar) | Wrong, then OK | Said a college "ranked 1 with 0 points". Fixed in code (no ranking before any result); on re-ask it refused to name a winner |
| s_why | Partial | No reason recorded, but listed show-up differences without calling them associations |
| s_demo_change | OK | B1, B2, B3 on Change with K03, K06, K09 values |
| s_demo_why | OK | K06 17.1% against 25% scale and 15% stop; action quoted |
| s_demo_task | Wrong | Drafted a task about campaign cost flags, not the squad bet the chat was about |
| s_demo_follow | Partial | Computed "7.9 points" itself (flagged by the number check) |
| s_demo_unknown | OK | Says drop-outs and reasons are not recorded |

## gemini-3.1-flash-lite (backup)
29 of 31 answered (2 "model busy" errors). Clearly weaker: it often answered from the summary without calling a tool.
- Wrong: s_claims (said approvals and refunds are not available), s_attend (said both-days is not available),
  ticket_task (said it cannot read tickets), s_demo_why and s_demo_follow (no KPI looked up; s_demo_follow answered with
  budget left instead), task (typed the task as JSON, no draft card), edit_request (typed a link to "https://").
- Invented figures, all caught by the number check: 37,915 and -69 (whatif_pre), 18,000 (s_contingent, s_demo_follow).
- Right: o_nobets, o_bets, funnel, edited_data, why, hindsight, s_overbooked, s_champ, s_lockin, demo_move,
  s_demo_unknown, s_hindsight (refused).

## Changes made because of this run
1. Championship tool: no ranking or leader before any competition result is recorded.
2. Loop: a typed link whose address is not a web address with a host or an app path keeps its words only.

## Still imperfect (model behaviour)
- Arithmetic the rules forbid (24.1%, 7.9 points); the number check flags these, it does not stop them.
- "Act on that" can drift to another topic (s_demo_task). Ask for the task by name.
- The button tool is sometimes described instead of called.
- 3.1 skips tools; keep 3.5 first.
