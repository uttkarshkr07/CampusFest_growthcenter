# CampusFest 2025 Growth Center

RISA Labs Growth APM take-home, **Challenge A: Attendee Growth**. By Uttkarsh Kumar.

- **Product:** https://campusfest-growth-center.uttkarsh-iitkgp.workers.dev
- **3-slide deck:** DECK LINK TO BE ADDED

CampusFest 2025 is a fictional fest (12 and 13 April 2025). Tags used throughout: **[S]** sourced (a link, a dataset reference, the user's Spring Fest records, or an input I fixed for the plan, marked as such), **[A]** assumption.

## TL;DR
- **Goal:** maximise **actual attendees** (distinct external people with an admitted and verified gate scan) for a Delhi NCR fest. 2025 had 2,050.
- **Target:** base **10,521** actual attendees from 15,003 registrations; stretch **12,844** (capped by 13,000 passes); INR 10,00,000 for media and bets. It comes from a model built on the 2025 rates, sourced Delhi NCR sizing, Spring Fest records and labeled assumptions (sections 3 and 4).
- **Five bets, ranked by ICE:** (1) college contingents with a College Championship, (2) Squad Pass, (3) two-step payment with exam-clash insurance, (4) Attendance Exchange, (5) RISA AI x Health Hackathon (a SIMULATED SCENARIO: RISA Labs has not agreed to this). Each has a check date, thresholds and a Scale / Change / Stop action (section 6).
- **Product:** a live Growth Center that measures, diagnoses, decides and manages (Overview, campaigns, bet tracker, actions, what-if, tasks, tickets between teams, campus map, event list, Championship, sponsors, editable data with Reset). Every figure is recomputed from the current data, as of any date (section 8).
- **Copilot (Mayu):** a free-tier Gemini model that answers only through 22 engine tools, does no arithmetic itself, separates evidence from assumptions, says when the data cannot answer, never sees later data, and creates a task only after you confirm (section 9).
- **Both provided datasets are used** (attendee and sponsor), plus tickets between teams, because growth depends on the teams talking to each other (see *Decisions and why*).
- **Two attendee datasets in the app:** the original 2025 data, and a clearly labeled **SIMULATED** run of the five bets (16,411 registrations, 10,969 actual attendees, ten operational anomalies) for testing the bet tracker and copilot. The simulation is never evidence for the target.
- **Graders:** sign in as **Reviewer**. Change any data and every figure updates; **Reset** restores it.

## Decisions and why
These are my decisions. Where a reason was recorded, it is given.

**Problem and metric**
- **Challenge A, counting actual attendees only.** Reach, registrations and confirmations are steps towards attendance, not attendance. The single biggest 2025 leak was 575 confirmed people who never came.
- **Delhi NCR.** The largest student pool within a metro commute: 4,78,736 regular-mode higher-education students in Delhi alone on a 393 km metro network [S] (section 2).
- **Scale up from the dataset.** The 2025 data is a small placeholder, so I use its **rates** (show-up, cost per actual attendee, channel behaviour) as evidence and size the audience and budget for a major Delhi NCR fest. Every assumption is labeled.

**Why both datasets, and tickets, although I chose Challenge A**
- Challenge A needs only the attendee dataset. I also brought in the **sponsor dataset** and built **tickets between teams**. Whatever metric a fest wants to maximise, the most important thing is a proper communication channel between its teams: publicity, sponsorship and events depend on each other. A sponsor-funded event needs publicity to fill it and events to run it, and a campaign flag on the attendee side can need sponsorship to act.
- So the product shows sponsor records (view-only) next to the attendee data, and any team can raise a ticket to another, which is accepted or declined, tracked to done and linked to tasks. The copilot reads both datasets and the tickets, so it can answer across teams. The seeded RISA hackathon ticket from sponsorship to publicity is an example of this flow.

**The bets**
- **Ranked with a named framework (ICE),** not by the order I first wrote them. The hackathon moved from first to fifth because it adds the fewest attendees (about 150 participants) and needs real organiser effort (overnight room, power, Wi-Fi, food, security, judges). Its value is sponsor value.
- **Ideas rejected, with reasons from our own data:** reminder messages (people who only opened or clicked emails showed up 69% against 68% with no engagement); attendance prediction (it would only reorder who gets nudged, and nudges showed no effect); a day-before chatbot concierge (question-askers showed up more, but asking signals intent the person already has, and a static FAQ covers the questions); shuttles and a logistics guide (too much operational load for organisers).
- **Design rules for the bets:** a squad pays full price and gets 20% back only when all five arrive (the gate scan checks this); the pass gives fest and Pronite entry, and capacity-limited shows need a free seat booking; the Attendance Exchange trades show seats (free claim, 10-minute window); routes (individual, squad, contingent) are exclusive and do not stack money; the overlap between squads, contingents and two-step payment is removed, not added.
- **"15,000 to 20,000" means registrations;** actual attendees land lower at the modelled show-up.

**Data and honesty**
- **The original data stays loadable and switchable,** because graders will test with it. The new data is a **labeled simulated run** of the bets, used to show how the tracker and copilot behave. The deck's target comes from the model, never from the simulation.
- **Every number is sourced [S] or an assumption [A].** No figure from one dataset is used as a result in the other.
- **Strict hindsight:** nothing after the selected date is visible anywhere, so a grader can stand on 15 March and see only what the team knew then.

**Product and copilot**
- **Calculations in code, not in the model.** The same engine drives the screens and the copilot. Every result carries its basis and caveats, so the copilot can cite evidence and say when the data cannot answer.
- **The copilot's only write is a new task, after confirmation.** For any other change it shows a "Take me there" button, so a model can never change data by itself.
- **Free tiers only** (Gemini free tier, Cloudflare Workers Free, Supabase Free). Calculations run in the browser because the Worker's CPU allowance is small. The UI states that the free tier lets Google use questions to improve its products.
- **Sign-in with demo accounts and roles,** so histories and permissions are separate per team, with Reviewer able to edit and reset everything.
- **Chats are filtered by dataset**, simulated tables sit beside the originals (`sim_` tables), and among the new bet tables only thresholds are editable, on the bet cards.
- **Sponsor records are view-only** and published in the repo (approved).
- **The campus map is for the website, not the deck,** so the three slides stay on the target, the bets and the tracking.

**Deck and brand**
- Three slides built as an editable PPTX and finished in Canva. RISA-style black, white and blue with no purple, the Poppins font, a peacock-feather logo with a thin "CF" in its eye, the mascot **Mayu**, and the invented fest identity "True Spirit of Youth", Est. 1997.

## Contents
1. [Summary](#1-summary)
2. [Research](#2-research)
3. [Assumptions](#3-assumptions)
4. [Detailed calculations](#4-detailed-calculations)
5. [Prioritization framework](#5-prioritization-framework)
6. [The five bets](#6-the-five-bets)
7. [Data](#7-data)
8. [Product](#8-product)
9. [Copilot design](#9-copilot-design)
10. [Setup](#10-setup)
11. [Tools and plans used](#11-tools-and-plans-used)
12. [Testing](#12-testing)
13. [Known limitations](#13-known-limitations)

## 1. Summary

**City: Delhi NCR.** Delhi alone has 4,78,736 regular-mode higher-education students ([AISHE 2021-22](https://cdnbbsr.s3waas.gov.in/s392049debbe566ca5782a3045cf300a3c/uploads/2024/02/20240719952688509.pdf)) on a 393 km metro network ([PIB, Dec 2024](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/dec/doc20241210468401.pdf)) [S].

**Goal metric:** actual attendees = distinct external people with at least one admitted **and** verified gate scan. Walk-ins count. Host students, staff, test records, denied and pending scans do not. Reach and registrations are not attendees.

| | 2025 actual [S] | Base | Stretch |
|---|---|---|---|
| Registrations | 2,800 | 15,003 | 20,007 |
| **Actual attendees** | **2,050** | **10,521** (5.1x) | **12,844** (6.3x) |
| Marketing and bet operating spend, INR | 2,74,000 | 10,00,000 | 10,00,000 |
| That spend per actual attendee, INR | 134 | 95 | 78 |

- The stretch is **capacity-bound**: demand is 15,524 against a cap of 13,000 external passes.
- **The weakest part:** 66.7% of base registrations rest on two assumed lines (college contingents and unpaid lineup pull).

**Five bets, ranked by ICE:** (1) College contingents and the CampusFest Championship, (2) Squad Pass, (3) Two-step payment with exam-clash insurance, (4) Attendance Exchange, (5) RISA AI x Health Hackathon (**SIMULATED SCENARIO: RISA Labs has not agreed to this**).

## 2. Research

### Delhi NCR sizing
| Fact | Value | Source |
|---|---|---|
| Delhi higher-education students, all modes / regular mode | 11,45,390 / 4,78,736 | [AISHE 2021-22](https://cdnbbsr.s3waas.gov.in/s392049debbe566ca5782a3045cf300a3c/uploads/2024/02/20240719952688509.pdf), Tables 6 and 6(a) |
| Delhi NCR metro network | 393 km, India's largest | [PIB, Dec 2024](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/dec/doc20241210468401.pdf) |
| Delhi University colleges | 91 | [Careers360](https://news.careers360.com/du-university-court-elects-seven-members-unopposed-ug-pg-admissions-exceed-72000-seats-rankings-recruitment-vc-yogesh-singh/amp) |
| GGSIPU institutes | 107 | [Delhi Higher Education Directorate](https://higheredn.delhi.gov.in/higher-education/guru-gobind-singh-indraprastha-university-0) |

The college universe for contingents is 198. The two counts date from different times. No figure was found for students in NCR outside Delhi, so that number is an assumption. A competing-fest calendar was not researched.

### RISA Labs context (why a Health x AI idea)
RISA Labs builds an AI operating system for oncology workflows such as prior authorization. It announced a [USD 3.5M seed round in April 2025](https://hitconsultant.net/2025/04/17/risa-labs-raises-3-5m-for-ai-powered-oncology-prior-authorizations-platform) and a [USD 11.1M Series A in January 2026](https://www.biospace.com/press-releases/risa-labs-closes-11-1m-series-a-to-scale-ai-operating-system-for-oncology-nationwide) [S]. Its tagline, "Making Institutions Win", is on the assignment PDF. Both announcements come after the fictional fest date and are background only.

### Spring Fest, IIT Kharagpur [S: user's Spring Fest records, not public]
About 30,000 total footfall over 3 days; about 25,000 registrations besides about 10,000 own-college students; pass about INR 2,300; contingents of 50 to 200; standup shows fill fast and people are turned away. This shows that this scale, a paid pass and these contingent sizes exist. **No show-up rate is taken from it**, and it is a long-established three-day fest.

### What 2025 showed [S: original attendee dataset]
| Finding | Figure |
|---|---|
| Show-up varies by channel | 50% (Paid Social, Creators) to 85.6% (College Partnerships) |
| Email opened or clicked, vs no email or question | 69% vs 68% showed up |
| Asked a question | 79% showed up |
| Registered in the last 4 weeks, vs 6 to 10 weeks out | 72-73% vs 62-64% showed up |
| Confirmed no-shows | 575, of whom 60 reached the gate and were denied or left pending |
| Waitlist | 88 people, none attended (the data does not say capacity caused the waitlist) |

All of these are **associations, not causes**. The timing effect is also not monotonic: the small group that registered 10 or more weeks out showed up at about 79%.

### Compliance, not verified
If a pharmaceutical company co-sponsors the hackathon, its obligations under [UCPMP 2024](https://pharma-dept.gov.in/sites/default/files/UCPMP%202024%20for%20website.pdf) need checking. The code governs industry conduct toward healthcare professionals; how it treats student events has **not** been verified. RISA is not assumed to be covered.

## 3. Assumptions

### Sourced inputs
| Input | Value | Source |
|---|---|---|
| 2025 identified / registered / attendees | 3,625 / 2,800 / 2,050 (1,925 registered + 125 walk-ins) | Original attendee dataset |
| 2025 spend, channel spend, registrations, attendees | INR 2,74,000; table in section 4 | Original attendee dataset |
| 2025 Day 1 share of attendees | 92.9% | Original attendee dataset |
| Gate buyers and walk-ins | 6.5% of registered attendees (125 / 1,925) | Original dataset. Applying it to a **paid** fest is [A] |
| Budget cap | INR 10,00,000 | Fixed for the plan (user) |
| Pass price / booking amount | INR 500 / 99 normal, INR 1,500 / 299 with accommodation | Fixed for the plan (user's design). Not market data |
| Pronite ground capacity per night | 20,000 | Fixed for the plan (user) |
| Show seats | 4 headline standup shows, 3,200 seats; 31 bookable sessions, 16,350 seats | CampusFest simulated program (illustrative; no artist or company is booked or affiliated) |
| Championship points | 1,630 across 24 scored events | Same program |
| Hackathon size | 150 participants (about 40 teams) | Draft scenario, **SIMULATED** |

### Planning assumptions [A]
No pricing data exists in 2025, so **every paid-funnel rate below is assumed**.

| Assumption | Base | Stretch | Reasoning |
|---|---|---|---|
| Colleges signed x average contingent | 70 x 100 | 90 x 120 | 100 colleges visited out of 198. Sizes sit inside Spring Fest's 50 to 200 [S]. 90 signed is aggressive |
| Unpaid lineup pull (registrations) | 3,000 | 3,250 | Pronites, shows and word of mouth; it takes the 2025 average show-up index |
| Squad share of non-contingent registrations | 25% | 30% | Group sign-up is common at fests; no squad data exists, so the share is tested early (K06) |
| Individual: pre-book / lock-in / show-up | 70 / 85 / 90% | 75 / 88 / 92% | Most drop-off is at the first payment; a fully paid person is likely to come |
| Squad: pre-book / lock-in / show-up | 80 / 88 / 94% | 85 / 90 / 95% | Higher than individual: friends commit together and the reward needs all five |
| Contingent: pre-book / lock-in / show-up | 85 / 92 / 92% | 88 / 93 / 93% | A named head follows up and OD letters protect attendance |
| Two-step payment relative uplift, registered to attended | 8% | 10% | Later full payment and gate pre-approval. No evidence of size, so it is A/B tested |
| Contingent registrants who would sign up anyway | 25% | 25% | Not credited to the contingent bet |
| Share of the squad-vs-individual gap caused by the pass | 50% | 50% | The rest is self-selection |
| Squad registrants who are new | 20% | 20% | Most friends would have registered anyway |
| Hackathon participants already registered | 30% | 20% | Part of the audience is already in the fest funnel |
| Cost of a registration above 2025 channel spend | 2.0x average | 1.5x average | Channels saturate; spend is not scaled linearly |
| Pass cap (external) | 13,000 | 13,000 | 20,000 x 90% safe fill minus 5,000 host students, staff and guests |
| Accommodation share of passes | 15% | 15% | Used for the average pass price |
| Exam-clash claims | 3% of locked-in | 3% | Reserve level; reviewed if claims pass 2% by 1 Apr |
| Voided passes refilled when sold out | 60% | 60% | Needs a pass waitlist and a 10-minute payment window |
| Squads where all five check in | 70% | 70% | Used for the cashback cost |
| Members per contingent getting the 25% price | 10 | 25 | How far contingents grow past a tier |
| NCR outside Delhi student pool | 200,000 | | No district-level figure found |
| Health x AI pool (inside segments 1 and 2) | 40,000 | | Medical, nursing, pharmacy and AI builders |
| Outstation competing contingent pool | 10,000 | | Competitors who travel |
| Segment shares of base registrations | 66 / 24 / 5 / 5% | | Planning split, not measured conversion |

Also [A]: the bet cost lines and media split (section 4), ICE Confidence and Ease scores (section 5), and **every scale / change / stop threshold, check date and minimum sample** (section 6). In the product, thresholds are edited on the bet cards (simulated run only; publicity team and Reviewer; each change is logged and Reset restores it).

## 4. Detailed calculations

All arithmetic is in [`docs/model_calc.py`](docs/model_calc.py), with its saved output in [`docs/model_output.txt`](docs/model_output.txt). It reads no files; rerun it with `python -I docs/model_calc.py`. Results are fractional people rounded for display, so some rows differ from their total by 1.

### 4.1 Audiences, in priority order
| # | Segment | Size | Share of base regs [A] | Base regs (% of segment) | Base attendees (pro rata) | Why this priority |
|---|---|---|---|---|---|---|
| 1 | Delhi regular-mode college students | 478,736 [S] | 66% | 9,902 (2.1%) | about 6,944 | Largest; metro commute; reachable college by college |
| 2 | NCR outside Delhi (Noida, Gurugram, Ghaziabad, Faridabad) | 200,000 [A] | 24% | 3,601 (1.8%) | about 2,525 | Same channels, longer commute |
| 3 | Health x AI, inside 1 and 2 | 40,000 [A] | 5% | 750 (1.9%) | about 526 | New audience; hackathon hook |
| 4 | Outstation competing contingents | 10,000 [A] | 5% | 750 (7.5%) | about 526 | Committed competitors; accommodation pass |

Health x AI is carved out of segments 1 and 2, so base needs 2.2% of the 678,736 people in segments 1 and 2. Host students are not a segment: they do not count, but they use ground space.

### 4.2 The 2025 baseline [S]
Funnel: 3,625 identified, 2,800 registered (77.2%), 2,500 confirmed external, 1,925 registered attendees + 125 walk-ins = 2,050. Registered to attended: 68.8%.

| Channel | Spend INR | Registered | Attended | Show-up | INR per actual attendee |
|---|---|---|---|---|---|
| C01 Campus Ambassadors | 42,000 | 520 | 390 | 75.0% | 108 |
| C02 Paid Social | 93,000 | 680 | 340 | 50.0% | 274 |
| C03 Creator Partners | 59,000 | 350 | 175 | 50.0% | 337 |
| C04 College Partnerships | 31,000 | 450 | 385 | 85.6% | 81 |
| C05 Student Referrals | 19,000 | 350 | 275 | 78.6% | 69 |
| C06 Organic Search | 14,000 | 250 | 195 | 78.0% | 72 |
| C07 Community Groups | 16,000 | 200 | 165 | 82.5% | 97 |

### 4.3 Budget
| Bet operating cost [A] | Lines | INR |
|---|---|---|
| Contingents | 100 college visits x 1,500 = 150,000; two trophies, head kits, OD letter printing 70,000 | 220,000 |
| Two-step payment | 2,000 wristbands x 30 = 60,000; wallet credit 200 x 100 + 300 x 50 = 35,000; messages 15,000 | 110,000 |
| Squad Pass | Promotion creatives | 40,000 |
| Hackathon | Fest-side publicity | 25,000 |
| Attendance Exchange | Claim-window SMS and WhatsApp | 10,000 |
| **Bet operating total** | | **405,000** |
| **Channel media** | 10,00,000 - 405,000 | **595,000** |

### 4.4 Channel media with rising marginal cost
- Average cost per registration, `cpr` = 2025 spend / 2025 registrations.
- If media <= 2025 spend: registrations = media / cpr.
- Otherwise: registrations = 2025 registrations + (media - 2025 spend) / (cpr x m), where m = 2.0 (base) or 1.5 (stretch).
- Show-up index = channel show-up / 68.8%.
- Channel cost per actual attendee = media / (registrations x individual paid-funnel rate x index x 1.065).

Example, C01 base: cpr = 42,000 / 520 = 80.77. Registrations = 520 + 98,000 / 161.54 = 1,127.

| Channel | Media INR | Base regs (vs 2025) | Stretch regs (vs 2025) | Index | INR per actual attendee, base / stretch |
|---|---|---|---|---|---|
| Campus Ambassadors | 140,000 | 1,127 (2.2x) | 1,329 (2.6x) | 1.09 | 200 / 149 |
| Paid Social | 80,000 | 585 (0.9x) | 585 (0.9x) | 0.73 | 330 / 291 |
| Creator Partners | 40,000 | 237 (0.7x) | 237 (0.7x) | 0.73 | 406 / 358 |
| Student Referrals | 135,000 | 1,418 (4.1x) | 1,775 (5.1x) | 1.14 | 146 / 103 |
| Organic Search | 60,000 | 661 (2.6x) | 798 (3.2x) | 1.13 | 140 / 103 |
| Community Groups | 140,000 | 975 (4.9x) | 1,233 (6.2x) | 1.20 | 210 / 146 |
| **All** | **595,000** | **5,003** | **5,957** | | **194 / 142** |

College Partnerships has no media line: the contingent bet replaces it, so it is not counted twice. These channels get **more** expensive than 2025 (INR 194 base, 142 stretch, against 134). The whole-plan blend of INR 95 (78) is lower **only because** contingent and organic registrations are assumed to need little media.

### 4.5 Reach to registrations
| Line | Base | Stretch |
|---|---|---|
| a) Paid and owned channels | 5,003 | 5,957 |
| b) Contingents (colleges x size) | 70 x 100 = 7,000 | 90 x 120 = 10,800 |
| c) Unpaid lineup pull | 3,000 | 3,250 |
| **Registrations** | **15,003** | **20,007** |
| Contingent share / organic share / both | 46.7 / 20.0 / 66.7% | 54.0 / 16.2 / 70.2% |
| Reach for a) + c): named, de-duplicated people = (a + c) / 77.2% | 10,361 | 11,919 |
| Reach for b): colleges visited, then signed (of 198) | 100, then 70 | 100, then 90 |

"Reach" means identified people or colleges visited, never summed advertising reach.

### 4.6 Registrations to attendees, by route
Registration is a free sign-up. Pre-booking is INR 99 (299). Lock-in is full payment with ID and photo by 2 April. Each person takes exactly **one** route.

Contingent registered-to-attended = pre-book x lock-in x show-up. For individuals and squads this product is also multiplied by the registration-weighted channel show-up index of the media and organic pool. The tables show that adjustment in the pre-book column (73.2% against a 70% input), with lock-in and show-up held at their inputs.

| Base route | Registered | Pre-booked | Locked-in | Attended | Registered to attended |
|---|---|---|---|---|---|
| Individual | 6,002 | 4,393 (73.2%) | 3,734 (85%) | 3,361 (90%) | 56.0% |
| Squad (400 squads) | 2,001 | 1,674 (83.6%) | 1,473 (88%) | 1,384 (94%) | 69.2% |
| Contingent | 7,000 | 5,950 (85.0%) | 5,474 (92%) | 5,036 (92%) | 71.9% |
| **All** | **15,003** | **12,017** | **10,681** | **9,781** | |
| + gate buyers and walk-ins (6.5%) | | | | 635 | |
| + hackathon, 150 less 30% overlap | | | | 105 | |
| **Base actual attendees** | | | | **10,521** | **70.1% of registrations** |

| Stretch route | Registered | Pre-booked | Locked-in | Attended | Registered to attended |
|---|---|---|---|---|---|
| Individual | 6,445 | 5,098 (79.1%) | 4,486 (88%) | 4,127 (92%) | 64.0% |
| Squad (552 squads) | 2,762 | 2,476 (89.7%) | 2,229 (90%) | 2,117 (95%) | 76.7% |
| Contingent | 10,800 | 9,504 (88.0%) | 8,839 (93%) | 8,220 (93%) | 76.1% |
| **All** | **20,007** | **17,078** | **15,554** | **14,465** | |
| + gate and walk-ins 939, + hackathon (150 less 20%) 120 | | | | 15,524 demand | |
| Pass cap 13,000 | | | | -2,524 | |
| Exam-claim passes voided when sold out (13,000 x 3%) | | | | -390 | |
| Refilled by the exchange (60%) | | | | +234 | |
| **Stretch actual attendees** | | | | **12,844** | **64.2% of registrations** |

### 4.7 Bridge from 2025, with overlap removed
| Step | Base | Stretch |
|---|---|---|
| 2025 actual [S] | 2,050 | 2,050 |
| Scale-up with no bet (channels, organic, contingent sign-ups who would come anyway) | +3,218 | +5,125 |
| B1 College contingents | +4,000 | +6,284 |
| B2 Squad Pass | +377 | +545 |
| B3 Two-step payment | +772 | +1,400 |
| B5 Hackathon | +105 | +120 |
| Pass cap, then voided passes | 0 | -2,524, then -390 |
| B4 Attendance Exchange refill | 0 | +234 |
| **Target** | **10,521** | **12,844** |

The bridge adds bets one at a time in rank order. "Without a bet" means: without B1, only 25% of contingent registrants sign up and they convert like individuals; without B2, 20% fewer squad registrants and half the squad rate advantage disappears; without B3, rates are divided by 1 + uplift; without B5, no hackathon people.

**Overlap.** Measuring each bet as if it were added last gives 4,320 (B1) + 407 (B2) + 772 (B3) + 105 (B5) + 0 (B4) = **5,604** in base. 350 of that is counted twice, so the net from all bets is **5,253** (stretch: 9,032 gross, 8,349 net before the cap, 5,669 after it). In base, 1,750 contingent registrants are assumed to come anyway and are not credited to B1.

| Operating cost per leave-one-out attendee, base | INR |
|---|---|
| B1: 220,000 / 4,320 | 51 |
| B2: 40,000 / 407 | 98 |
| B3: 110,000 / 772 | 143 |
| B5: 25,000 / 105 | 238 |
| B4: 10,000, adds no distinct attendee in base | not defined |

**Opportunity cost:** INR 405,000 put into media instead would buy about 1,958 registrations and 1,117 attendees (base), at twice the 2025 non-partnership average cost per registration. The bets add 5,253.

**Stress test on the contingent line:** buying the 5,036 base contingent attendees at twice the 2025 College Partnerships cost (INR 162 each) would take INR 815,845 of the 10 lakh. The plan spends INR 220,000 because it assumes contingent heads recruit and tier discounts come out of pass revenue. **If heads do not recruit, the target does not hold.**

### 4.8 Capacity
- Pass cap = 20,000 x 90% - 5,000 = **13,000** external passes per night.
- Day 1 external, using the 2025 Day 1 share: about 9,777 (base) and 11,936 (stretch); with 5,000 internal people, 14,777 and 16,936 of 20,000.
- With a 15,000 cap (the whole ground less host students), stretch would be **14,820**.
- Entry does not bind in base. Show seats do: 3.3 base attendees per headline standup seat (3,200 seats, 1,600 per day).
- Hostel bed capacity is not modelled.

### 4.9 Money paid from pass revenue, outside the marketing budget [A]
Average pass = 85% x 500 + 15% x 1,500 = INR 650. Average refundable amount = 85% x 401 + 15% x 1,201 = INR 521.

| INR | Base | Stretch |
|---|---|---|
| Indicative gross pass revenue (attendees x 650, before gate pricing) | 6,838,827 | 8,348,600 |
| Squad cashback (squad attendees x 70% x 20% x 650) | 125,977 | 192,663 |
| Contingent 25% discount (colleges x 10 or 25 members x 25% x 650) | 113,750 | 365,625 |
| Exam-clash reserve (3% of locked-in x 521); number of claims | 166,941 (320) | 243,104 (467) |
| Total as share of gross | 5.9% | 9.6% |

### 4.10 Sensitivity (base)
| Change | Attendees |
|---|---|
| Lock-in -10 and show-up -8 points / +5 and +3 points | 8,542 / 11,467 |
| Pre-book rate -15 / -30 points | 8,532 / **6,542** |
| Signed colleges 40 / 55 / 70 / 85 | 8,223 / 9,372 / 10,521 / 11,671 |
| No unpaid lineup pull | 8,710 |
| **Floor:** 40 colleges and no lineup pull (9,003 registrations) | **6,411** |

Price acceptance (pre-book rate) and signed colleges matter most. Both are visible weeks before the fest.

## 5. Prioritization framework

**ICE = Impact x Confidence x Ease.**
- **Impact** = 1 + 9 x (bet's base leave-one-out attendees / the largest of these). Computed.
- **Confidence** (1 to 10, judged): how far 2025 or Spring Fest evidence supports the bet.
- **Ease** (1 to 10, judged): inverse of cost and organiser effort.

| Rank | Bet | Impact | Confidence | Ease | ICE | Reason for the judged scores |
|---|---|---|---|---|---|---|
| 1 | College contingents and Championship | 10.0 | 7 | 4 | **280** | 85.6% partnership show-up and Spring Fest contingent sizes [S]; 100 visits, OD letters and a scoring desk |
| 2 | Squad Pass | 1.8 | 5 | 8 | **74** | Referrals showed up at 78.6% [S], but no squad data; a form field and a cashback |
| 3 | Two-step payment | 2.6 | 4 | 5 | **52** | No pricing data at all; needs payment and claim software |
| 4 | Attendance Exchange | 1.0 | 4 | 5 | **20** | Standup turnaways show seat demand [S], not claim behaviour; needs claim software |
| 5 | RISA AI x Health Hackathon | 1.2 | 4 | 3 | **15** | Sponsor not agreed; overnight room, power, Wi-Fi, food, security and judges |

- **Ranks 2 and 3 are fragile.** With an 8% two-step uplift, B3 scores 52 against Squad's 74. At 10% it scores 59, at 12% 67, and **at 15% it scores 77 and overtakes Squad** (at 20%, 92).
- **Build order differs from rank.** The payment system ships first, because the squad cashback and the exchange depend on it.
- Ranks 4 and 5 are close (20 and 15).

**Double down** on B1 (about three quarters of the net bet gain in base, and the best evidence), and on the payment system that B2, B3 and B4 share. **Keep small** the Exchange (seat fill and fairness, not a growth line) and the Hackathon (a segment and sponsor bet, stage-gated).

**Deprioritized**
| Idea | Why |
|---|---|
| Scaling Paid Social and Creators | 50% show-up, INR 274 and 337 per actual attendee [S]. Cut to INR 80,000 and 40,000 as an awareness floor |
| A bigger headliner | A night is limited to 13,000 external passes; a costlier act takes budget from distinct-attendee growth [A] |
| Reach-only influencer buys | Reach is anonymous events, not people |

**Rejected** (the 2025 evidence is association only)
| Idea | Why |
|---|---|
| Reminder cadence (WhatsApp, SMS, email at T-7, T-2, event morning) | Registrants who opened or clicked email showed up 69%, vs 68% with no engagement [S]: no sign of an effect. Payment and claim messages stay because they carry an action |
| Attendance prediction with targeted nudges | Data exists (show-up differs by channel, 50% to 86%, and by registration timing), but a prediction only reorders who gets nudged, and nudges showed no sign of an effect |
| Day-before concierge chatbot | People who asked a question showed up 79% vs 68% [S]. Asking signals intent they already had; answering does not create it. A static FAQ covers the questions |
| Shuttles and a personalised logistics guide | Heavy operating load for organisers |

## 6. The five bets

Dates are in 2025. All thresholds, dates and minimum samples are [A]. KPI codes (K01 to K24) are the product's bet tracker codes. Verdicts, in order: **Not applicable** (this dataset has no such records), **Too early** (before the check date), **Not enough data** (below the minimum sample), then **Scale / Change / Stop**. A verdict is judged on data as of the check date; later dates also show the latest value.

**Shared dependencies:** payment and ID system (B2, B3, B4); verified gate scan (squad cashback, Contingent Trophy); seat booking (B4); results desk (Championship); written approval (B5); OD letters (B1). **Shared risks:** price acceptance hits every route; mid-April exams; the Day 1 evening gate peak; reliance on assumed contingent and organic lines.

### B1. College contingents and the CampusFest Championship
- **Concept:** deals with college administrations and societies. A named contingent head registers the delegation; OD (on-duty) letters protect class attendance. Two trophies: the CampusFest Championship (event points, 1,630 in total) and the Contingent Trophy (most verified attendees from one college).
- **Mechanics:** championship positions score 100 / 60 / 40 / 20 / 10% of an event's points, and ties split the occupied positions equally. At 50 locked-in members the contingent gets 25% off the next 10; at 100, off the next 15; at 150, off the next 20 (the cheer squad). Offers appear as the contingent grows.
- **Why it could work:** College Partnerships had 2025's best show-up, 85.6%, at INR 81 per attendee [S]. Spring Fest contingents run 50 to 200 [S]. One yes from a college brings many students.
- **Contribution:** +4,000 base, +6,284 stretch before the cap.
- **Budget:** INR 220,000 operating; tier discounts from pass revenue (113,750 / 365,625).
- **Resources:** publicity (visits, heads), events (scoring desk, trophies, hostels), sponsorship (trophy partner).
- **Timeline:** 15-19 Jan college list and OD template; 20 Jan visits start (100 colleges); 10 Feb contingent registration opens; 1 Mar and 15 Mar checkpoints; 2 Apr lock-in; 13 Apr trophies.
- **Test:** two randomly assigned waves of 50 colleges. Wave A gets the full offer (OD letter, trophies, tiers); wave B gets trophies and tiers, with the OD letter two weeks later. Compare signed colleges and locked-in members per college. With 50 per arm only a large gap is readable, so the result is directional.
- **Critical variable:** members recruited per head. **Biggest risk:** heads sign but do not recruit.

| KPI | Check | Scale | Stop (between = Change) | Minimum sample |
|---|---|---|---|---|
| K02 signed colleges (early read) | 1 Mar | >= 45 | < 25 | 50 colleges visited |
| **K03 contingent registrations (lead signal)** | 15 Mar | >= 3,500 | < 2,100 | applies once >= 50 colleges are visited |
| K04 per-college pre-book rate | weekly from 1 Mar | >= 75% | < 50% | 30 members |
| K05 contingent show-up (attended / locked-in) | after fest | >= 85% | < 75% | 30 |
| K24 Championship standings | live | engagement measure | | |

**Change:** add a co-head and class representatives, push OD letters, visit more of the 198. **Stop:** stop new visits, move the remaining money to Referrals and Community Groups, and restate the target from the sensitivity table.

### B2. Squad Pass
- **Concept:** five friends register together and pay full price. 20% comes back (refund or on-site wallet credit, their choice) **only when all five have an admitted and verified scan**. A sponsor photobooth and minor perks unlock the same way.
- **Mechanics:** no other money benefit stacks on a squad pass [A]; the booking priority window still applies.
- **Why:** referrals showed up at 78.6% for INR 69 per attendee [S]; the reward depends on friends actually arriving.
- **Contribution:** +377 base, +545 stretch.
- **Budget:** INR 40,000; cashback from revenue (125,977 / 192,663). **Resources:** publicity; finance and tech for cashback.
- **Timeline:** 10 Feb squads open; 15 Mar checkpoint; 2 Apr squad lock-in; cashback paid by 20 Apr.
- **Test:** 10-23 Feb, show the cashback offer to a random half of new individual-route visitors; the control arm sees ordinary group registration. Compare people registered per visitor and paid pre-book rate, then attendance. 400 per arm detects about 9.1 points on a 70% baseline.
- **Critical variable:** whole squads completing. **Biggest risk:** one dropout removes everyone's reward, so squads give up.

| KPI | Check | Scale | Stop (between = Change) | Minimum sample |
|---|---|---|---|---|
| **K06 squad share of individual + squad registrations (lead signal)** | 15 Mar | >= 25% | < 15% | 200 registrations |
| K07 squads fully locked in | 2 Apr | >= 70% | < 50% | 30 squads |
| K08 full-squad arrival and cashback paid | after fest | plan 70% of squad attendees in complete squads | | any cashback without 5 qualifying scans is an anomaly |

**Change:** allow one substitute before lock-in and show squad progress. **Stop:** stop promoting, but keep the cashback promised to existing squads.

### B3. Two-step payment, early perks and exam-clash insurance
- **Concept:** pre-book for INR 99 (299 with accommodation) and pay the rest of INR 500 (1,500) by **2 Apr** with college ID and photo to lock in. The gate becomes a QR scan, and a hostel is allotted at prepayment. An unlocked pre-booking is released and the booking amount is kept [A].
- **Earlier payment, more benefit:** pre-booked by 28 Feb books shows from 3 Apr, by 15 Mar from 4 Apr, everyone else from 5 Apr (all after lock-in); a name wristband, collected at the fest, for the first 2,000; wallet credit of INR 100 for the first 200 pre-bookers and INR 50 for the next 300.
- **Refunds:** exam clash: INR 401 or 1,201 back with an official datesheet or signed college letter showing an exam on 12 or 13 Apr and matching ID, filed by 7 Apr or within 24 hours of a later datesheet; the QR is voided. **Normal cancellation: refund only if the pass is resold through the exchange, minus INR 50.** If passes do not sell out (the base case), a normal cancellation gets nothing back, and checkout must say so.
- **Why:** students commit once they know their schedule; 2025 show-up was 72-73% for last-four-week registrations against 62-64% six to ten weeks out [S]. Pre-approval removes gate friction: 60 of 575 no-shows reached the gate and were not admitted [S].
- **Contribution:** +772 base, +1,400 stretch.
- **Budget:** INR 110,000; exam reserve from revenue (166,941 / 243,104). **Resources:** tech and finance (payments, ID check), events (hostels), publicity.
- **Timeline:** 10 Feb pre-booking opens; 15 Mar checkpoint; 25 Mar mid-check; 2 Apr lock-in; 7 Apr claims close.
- **Test:** 10-23 Feb, randomly assign individual registrants to two-step or a single INR 500 payment with the same perks and insurance. Early read: share paying anything. Final read: attended per registrant. An 8% lift is about 4.5 points on the 56.0% base individual rate, and even 1,500 per arm only detects 4.7 points (70% baseline), so expect direction, not proof. Under 400 per arm it is reported as unreadable. If the squad test runs at the same time, the two are randomised independently.
- **Critical variable:** acceptance of the price and the second payment. **Biggest risk:** the count falls even if the show-up rate rises; a pre-book rate 30 points below plan takes base to 6,542.

| KPI | Check | Scale | Stop (between = Change) | Minimum sample |
|---|---|---|---|---|
| **K09 pre-book rate, sign-ups at least 7 days old (lead signal)** | 15 Mar | >= 55% | < 40% | 200 |
| K10 lock-in of pre-booked | 25 Mar | >= 45% | < 30% | 200 |
| K11 lock-in at deadline (plan 88.9%) | 2 Apr | >= 85% | < 70% | 200 |
| K12 two-step test, with 95% interval | 2 Mar early, final after fest | keep two-step unless single payment is clearly better | | 400 per arm; "not readable" if the interval includes 0 |
| K13 exam claims / locked-in | 1 Apr | <= 2% | > 3% (means: review reserve and proof checks) | 200 locked-in |
| K14 locked-in show-up and gate rescue | after fest | >= 90% | < 80% | 200 |

**Change:** call non-lockers, show the insurance at checkout, ask contingent heads to follow up. **Stop:** offer single payment to new sign-ups, honour existing bookings, extend lock-in to 5 Apr.

### B4. Attendance Exchange
- **Concept:** a waitlist per show. When a seat is cancelled, everyone waiting is told; the first into the claim screen holds it for 10 minutes, then it reopens.
- **Mechanics:** the pass gives fest and Pronite entry; capacity-limited shows need a free seat booking. **Show seats move free** between pass holders. If passes sell out, a cancelled pass goes to a **paid** pass waitlist (10-minute payment window). Live until 6 hours before.
- **Why:** standup fills fast and people are turned away [S: Spring Fest]; in 2025, 88 people were waitlisted and none attended while confirmed people did not show [S].
- **Contribution:** **0 new distinct attendees in base**, because a free seat moves between two people who already attend. +234 in stretch from refilled passes. Its value is filled seats and fewer turnaways.
- **Budget:** INR 10,000. **Resources:** tech, events (door staff).
- **Timeline:** seat booking 3-5 Apr; exchange from 3 Apr; pass waitlist from the day 95% of the cap is sold.
- **Test:** there is no fair A/B with 4 headline shows. Measure claim rate and median minutes to refill, and compare door fill of refilled and ordinary seats, reported as before-and-after, not causal.
- **Critical variable:** claim speed. **Biggest risk:** nobody claims in time, or claimants do not come.

| KPI | Check | Scale | Stop (between = Change) | Minimum sample |
|---|---|---|---|---|
| **K15 offers claimed within 10 minutes (lead signal)** | from 3 Apr | >= 60% | < 30% | 30 offers |
| K16 show seat fill (also demand and turnaways) | per session | >= 95% | < 80% | 1 completed session |
| K17 passes resold (plan 60%) | only once 95% of the cap is sold | else "Not applicable" | | 30 |

**Change:** notify in batches and add a second round. **Stop:** switch to a standby line at the door. Overbooking is not allowed; no-show seats are released to the door line at a stated cutoff.

### B5. RISA AI x Health Hackathon
**SIMULATED SCENARIO: RISA Labs has not agreed to this.**
- **Concept:** 24 hours, 12 Apr 11:00 to 13 Apr 11:00, with demos on the afternoon of 13 Apr. About 40 teams, 150 participants, synthetic data only.
- **Mechanics:** written sponsor approval is a stage gate; nothing public is spent before it. The overnight build, mentoring and rest use two halls; demos and awards use an auditorium.
- **Why:** reaches AI builders and medical, nursing and pharmacy students a cultural program may miss [A].
- **Contribution:** +105 base (150 less 30% already registered), +120 stretch. Sponsor money is not an attendee.
- **Budget:** INR 25,000 fest publicity. The scenario's sponsor support of INR 1,50,000 (INR 1,00,000 prizes) is **simulated, not received cash**.
- **Resources:** sponsorship, events, publicity. The effort is real: overnight room, power, Wi-Fi, food, security, hostel-curfew letters, judges, approvals.
- **Timeline:** 15 Mar internal ticket; 22 Mar approval gate; 24 Mar to 5 Apr registration; 31 Mar checkpoint.
- **Test:** a stage gate, not an A/B test.
- **Critical variable:** written approval, then teams. **Biggest risk:** the sponsor does not agree.

| KPI | Check | Scale | Stop (between = Change) |
|---|---|---|---|
| **K18 written approval (lead signal)** | 22 Mar | done | not done |
| K19 registered teams (also share new to the fest, plan 70%) | 31 Mar | >= 25 | < 10 |

**Change:** targeted outreach to computing and health colleges. **Stop:** cancel, or run a smaller unsponsored build night.

### Whole-plan guardrails and how tracking works
| KPI | Rule | Minimum sample |
|---|---|---|
| K01 actual attendees | Scored against 10,521 and 12,844 after the fest | none |
| K20 projected attendees | Weekly, against 10,521. Per route: locked-in x show-up, plus unlocked and unpaid people discounted by the plan rates (zero after 2 Apr), plus gate rate and hackathon, capped at 13,000. It projects current sign-ups only | none |
| K21 media INR per confirmed registrant (per actual attendee after the fest) vs blended | Scale <= 0.8x with show-up >= 75%; Stop >= 1.5x or show-up < 55% | 30 |
| K22 revenue givebacks / gross pass payments | Scale <= 10%; Stop > 15% (review discounts) | 200 paid passes |
| K23 bet spend vs budget, and spend per **modelled** increment | Flag over budget; incrementality is not observed. In the product it is the spend line on each bet card, with the total against INR 10,00,000 | none |

K24 (Championship standings) is the College Championship board, not a card with a verdict. K08 and K12 are tracked without a Scale / Stop verdict.

- **Tracking:** every KPI is computed from records, not typed in: gate scans, registrations with one route each, dated status histories, passes, payments, insurance claims, seat bookings, waitlists, exchange offers, competition results, hackathon teams, bet spend and milestones. If a person has two registrations, the earliest route wins.
- **No hindsight:** a record counts on a selected date only if its own timestamp is at or before the end of that day (IST).
- **Evidence:** non-randomised comparisons are never called causal.

## 7. Data

The app holds two datasets side by side, with a switch at the top. The copilot asks which one to use the first time it is opened.

### 7.1 Original 2025 data (as provided)
The brief's attendee dataset stays available for testing, with its own edits, tasks, tickets, change log and Reset; resetting one dataset never touches the other. The seed copy is in `data/seed` and is the fixture for the automated tests. The provided sponsor dataset is loaded as view-only records.

It has **no** squads, payments, passes, seats, waitlist offers, contingents or bet records. Of the bet KPIs it can answer K01, K20 (using confirmed registrants) and K21, with channel proxies for K05 and K14.

### 7.2 SIMULATED run of the five bets
> **SIMULATED: a made-up run of the plan. It is never used as evidence for the target.** The target comes only from the model in section 4 (2025 rates, sourced sizing, Spring Fest context and labeled assumptions).

- Generated by a seeded Python script (`dataset_gen/generate.py`, seed 2025; a rerun gives byte-identical workbooks) and checked by a separate plain-Python calculation and by the app engine on the same files (412 figures agree).
- **Size as built:** 16,411 registrations (7,100 contingent, 7,050 individual including 610 bot sign-ups, 2,261 squad), 18,944 identified external people, 11,299 confirmed, **10,969 actual attendees** (450 walk-ins) against the 10,521 base. Day 1 8,432, Day 2 6,037, both days 3,500. Media spend INR 5,85,400 plus bet spend INR 3,82,900 = INR 9,68,300 of the INR 10,00,000 cap. Peak valid passes 12,052 (cap 13,000). 60 confirmed sponsors, INR 75 lakh (reported, not cash). About 152 MB of the 500 MB free database.
- Channels keep their 2025 ratios through the paid funnel. Some bets underperform at a checkpoint (Change) and recover after the stated action; K06 squad share ends at 24.3%, just under its 25% scale line.
- Seat bookings for every bookable session, standup sell-outs and waitlists, exchange offers claimed or expired, pre-bookings, lock-ins, hostel allotment, exam claims, full and partial squads, contingents and tiers, Championship results, and hackathon teams.
- **Ten operational anomalies** across 15 Jan to 20 Apr (bot sign-ups, a contingent head who stops replying, a sponsor withdrawal, an exam clash and refund spike, hostel overflow, a payment gateway outage on lock-in day, an overbooked standup, night exchange offers expiring unseen, a wrong squad cashback, duplicate-QR attempts). Each has the signal that caught it, the fix, the result and the tickets that handled it (34 tickets).
- **Deviations from the plan:** the squad offer test runs 24 Feb to 9 Mar, not alongside the two-step test (one test per registration row); a tenth campaign, C10 "AI x Health Hackathon page", carries the hackathon participants; the hostel overflow signal comes on 2 Apr, not 30 Mar; College Partnerships (C04) is not the top channel (130 people in two weeks); tasks cannot be loaded, so owners and dates live in tickets and bet milestones.
- Added sponsors are fictional brands; the organiser team is unchanged. No simulated problem, quote, cancellation or money is attached to a named real artist or company. The full story, timeline and anomaly table: `dataset_gen/STORY.md` in the project folder.

### 7.3 Counting rules
| Situation | Rule |
|---|---|
| Actual attendee | External person with at least one scan that is admitted **and** verified, between event start and end. Walk-ins count |
| Internal, staff or test person; denied, pending or unverified scan | Not counted |
| Scan outside the event window, or with no readable time | Not counted, and listed |
| Repeated stable ID | Identical rows count once; if contents differ, the last row wins |
| Histories (registration status and others) | Full versions: take the latest at or before the end of the selected day (IST). Never summed |
| Daily marketing counts | Anonymous events, not people. Reach is never summed as unique people. Negative spend is a vendor credit |
| Two registrations for one person | Counted once, under the earliest |
| Unknown word (for example `entered`) or broken link between rows | Never guessed or matched; listed. Capitals and outer spaces are ignored and listed |
| Selected ("as-of") date | No later outcome appears in an earlier view |

2025 under these rules: 3,625 identified external; 2,800 registered; 2,500 confirmed external at event start; **2,050** actual attendees (1,925 registered + 125 walk-ins); 3,250 verified external admissions; 725 people attended both days. The revised verified-visitor goal was 2,200, so 2025 reached 93%. Full rules and the Excel workflow: [`DATA_GUIDE.md`](DATA_GUIDE.md).

## 8. Product

| Brief, Part 2 | In the Growth Center |
|---|---|
| **1. Measure** | Overview: funnel, targets vs actuals with versioned targets, conversion, spend vs budget, registration pace, projection, as of any date. Campaigns: per-campaign KPIs |
| **2. Diagnose** | Campaign ranking by cost per actual attendee and show-up, biggest funnel leak, what changed recently, show-up differences (as associations), Data quality tab |
| **3. Decide** | Scale / watch / stop flags with their reasons and numbers; Actions (the people behind each leak); What-if for budget moves, cuts and show-up with a cautious-to-optimistic range; bet tracker |
| **4. Manage** | Campaigns, tasks with owners and deadlines, tickets between teams, editable data with a change log. Edits recalculate every figure. Reset restores the loaded data |
| **5. Copilot** | A side panel and a full page with saved chats; see section 9 |

### Every feature, page by page
The menu is grouped **Run, Grow, Fest, Partners, System**. Every figure on every page is computed in the browser from the current data, as of the date chosen at the top right.

**Across the app**
- **Selected ("as-of") date** at the top right, with shortcuts *Today in story* (15 Mar 2025), *Event day 1* and *Post-event*. Nothing recorded after that date appears anywhere, including in the copilot.
- **Dataset switch** at the top: the original 2025 data or the SIMULATED run of the bets. Each has its own edits, tasks, tickets, change log, Reset and chats. The copilot asks which one to use the first time it is opened.
- **Sign-in** with one button per demo account (Reviewer and six team members) and role-based editing (table below).
- **Light and dark mode.**
- **Deep links:** "Take me there" buttons and links open the exact campaign, task, ticket, record, venue, event, bet, college, data-quality list or event rules.
- **Mayu,** the fest peacock, fronts the copilot: the panel button, the avatar and a greeting with one of three poses. The persona is a name, a picture and a greeting only; it never changes the rules, evidence or advice.

**Run**
- **Overview (mission control):**
  - A morning briefing.
  - A phase-aware hero: before the fest, a landing forecast with its range and how earlier forecasts did; on fest days, the live gate; after, the final result against the forecast.
  - **What needs attention:** one ranked feed built from every check the app runs, filterable by your team or all teams. It covers campaign flags, sign-up spikes (with a 7-day follow-up), sign-ups that stopped, spend outliers, capacity, bet verdicts, tickets, overdue tasks, people who can still be recovered, and data quality. Each item has its numbers and owner, and an *Ask copilot* button that fills in the question (it never sends on its own).
  - The leak funnel against the plan, a channel quadrant and table, budget burn, what changed (including the change log), a bets strip and an execution summary.
- **Copilot:** the full page with saved chat sessions (new, reopen, rename, delete), filtered by dataset. The same chat also opens as a side panel from any page (section 9).
- **Tasks:** owners, teams, due dates, status (including an *In progress* filter), overdue flags, and the reason and evidence for tasks made from a flag, a bet card or the copilot.
- **Tickets:** requests between publicity, sponsorship and events. Open, then accepted or declined (with an optional reason), in progress and done. Each ticket has its dated history, comments and linked tasks, and a count of tickets awaiting your team. Each ticket is shown as it stood on the selected date.

**Grow**
- **Campaigns:** per-campaign spend, identified, registered, confirmed, attended, show-up, INR per registration, per confirmed and per actual attendee, share of spend against share of attendees, and Scale / Watch / Stop flags with their reason. "+ Task" from any flag.
- **Bet tracker:** one card per bet with its KPIs (K01 to K22), verdict, the numbers behind it, minimum sample, spend against budget and a "+ Task" button that records the rule, numbers and date. Thresholds are edited on the cards themselves (simulated run only, logged, restored by Reset), not on the Settings page. On the original data only K01, K20 and K21 can be read, plus proxies for K05 and K14. A Championship tab shows the board.
- **Actions:** the people behind each leak (confirmed but not engaged, interested but not confirmed, waitlisted, failed a gate scan and never admitted), with full lists.
- **What-if:** budget moves between campaigns, cuts to the whole budget and show-up changes, with a cautious-to-optimistic range and its assumptions. Before the fest only unspent budget moves.
- **People:** search, and each person's touches, registration statuses and gate scans in order.

**Fest**
- **Event list:** every program session grouped into events by genre, with rules adapted from the Spring Fest rulebook where a page fits, and each session's seats as of the date.
- **Campus map:** an illustrated, fictional host campus with hostels (fest stay), academic buildings, food court, stadium and more. Clicking a venue shows capacity, its events by day and, for bookable events, seats offered and booked, waitlist, exchange claims and attendance as of the selected date. Venues are coloured by fill. On the original data it shows the program and says booking data does not exist there.
- **College Championship:** points by college with the position and tie rules, the Contingent Trophy and the contingent tiers reached.

**Partners**
- **Sponsors:** view-only funnel, targets, campaigns, opportunities, brand records and activations. Reported values are not cash received, and an activation link is not proof of cause.

**System**
- **Data:** every table is editable by role, with a change log (*Recent changes*) and a **Data quality** tab listing records left out, read differently or worth a check. Edits recalculate every figure. **Reset** restores the loaded data for the dataset on screen only.
- **Settings:** the assumptions behind projections, flags and what-if (show-up rates, walk-ins, flag thresholds, marginal cost multiples).

### Sign-in and roles
The sign-in screen has one button per demo account. **Graders: choose Reviewer.** Everyone signed in can view everything and comment on tickets.

| Account | Can edit |
|---|---|
| Reviewer | All editable data, tickets, tasks, and Reset |
| Meera, Nisha | Publicity and sponsorship work, including attendee campaigns, plans, daily marketing, targets and settings |
| Arjun | Publicity work, including the same attendee campaign data |
| Dev | Gate check-ins; events tickets and tasks |
| Riya, Kabir | Sponsorship tickets and tasks |

People, registrations, status history and interaction rows are Reviewer only. Sponsor records are view-only. The demo accounts separate roles and chat histories; they are **not** a security boundary (section 13).

### One complete copilot workflow (demo script, original data)
Choose the original data, then click **Today in story** (15 March 2025).
1. Ask: *"Are we on track for the verified visitor goal?"* Expect registration pace against the goal and a projection from people confirmed so far, which is not a forecast of the final number. No attendance exists yet.
2. Ask: *"What is the biggest risk right now?"* Check the evidence drawer to see which data and tools it used.
3. Ask: *"What if we move INR 20,000 from Paid Social to College Partnerships?"* Before the event only unspent budget moves, and only cost per **confirmed** is known. Expect a change, not a new total, with its assumptions. On the 2025 data at this date the result is a **loss** (-57 to -42), although after the fest College Partnerships is far cheaper per actual attendee (INR 81 against 274 at 20 April). The copilot cannot know that on 15 March.
4. Ask: *"Create a task to act on this."* Review and edit the draft, then confirm. Nothing is saved before you confirm. It appears on **Tasks** with its reason and evidence.
5. Follow up: *"Which channel will have the worst show-up?"* Expect it to say this is not known yet.
6. Ask: *"Why did people not show up?"* (set the date to 20 April). No reason is recorded; any differences it lists are associations.

**On the simulated data** (switch Data at the top to the simulated run; date 15 March 2025):
1. Open **Bets**. At 15 March, Squad Pass (K06 squad share 17.1% against a 25% scale line) and the contingent checks (K03 2,345 contingent registrations against 3,500) show **Change**.
2. Ask Mayu: *"Which bets show Change right now?"*, then *"Why is the Squad Pass bet on Change, and what does its rule say to do?"* Expect the KPI value, the threshold and the action written on the threshold row. Thresholds are assumptions.
3. Ask: *"Create a task for the publicity team to act on that."* Review the draft, confirm it, and find it on **Tasks**.
4. Follow up: *"How far is it from the Scale line?"*
5. Ask something the records cannot answer: *"Which friends' groups will drop out of their squads before the fest, and why?"* No reason or future outcome is recorded, so it should say so.

Every answer starts with the dataset it came from (*Data: Original 2025 data* or *Data: SIMULATED run with our bets*). The app adds that line itself, so it does not depend on the model.

## 9. Copilot design

```
Browser: question + selected date + engine summary + recent chat + sign-in token
  -> /api/copilot (Cloudflare Worker): checks sign-in and size, adds fixed rules, tool list and key
  -> Gemini: answers, or asks for tools
Browser: runs the tools on the loaded data, with dates forced to the selected date or earlier
  -> results {value, basis, caveats} go back to the model
Answer: Answer / Evidence / Assumptions / What the data can't tell / Next step
  -> task card (edit, confirm) or a "Take me there" button
```

- **Tools over current data:** funnel, targets vs actuals, campaign table, flags, projection, pace, momentum, show-up drivers, flexible query, action lists, what-if, people search, one person, tasks, tickets, data health, event info and sponsor records; for the bets, **betStatus** (each bet's KPIs, verdicts, thresholds and spend, or one KPI in detail), **bookings** (venues and sessions: seats, bookings, waitlist, exchange offers, door attendance, sold-out and overbooked), **championship** (standings, Contingent Trophy, contingents and tiers) and **payments** (payments by kind, passes by state, exam claims and refunds, the money KPIs); plus two action tools (propose a task, open a screen). 24 tools in all.
- **Both datasets:** the copilot reads whichever dataset the switch at the top shows; the switch is locked while an answer is on its way. The summary sent with each question names the dataset and, on the simulated run, gives each bet's headline verdict. Every answer starts with a line naming the dataset, added by the app. On the original data the four bet tools return no figures and say the records do not exist there; the model is told never to borrow figures from the other dataset or the plan.
- **Calculations are in code.** The same engine drives the screens and the copilot. The rules forbid the model from calculating.
- **Evidence and assumptions:** every engine result carries its basis and caveats. The answer keeps observed data apart from assumptions and treats group differences as associations.
- **"The data cannot answer":** the summary lists the tables and fields that exist. The model must say plainly what is missing and how to start collecting it. On the original data it says bet, booking and Championship data do not exist, and does not borrow simulated figures.
- **No hindsight:** nothing after the selected date reaches the model, including earlier chat turns written at a later date.
- **Task creation only after confirmation.** The only write action is proposing a new task. For other changes it shows a button to an allowlisted screen.
- **Number check:** the app flags any figure in an answer (small whole numbers aside) that is not found in the summary, tool results, question or recent chat. It **cannot** catch a real figure used with the wrong meaning.
- **Untrusted text:** text inside data is treated as information, never as an instruction. A ticket's "simulated scenario" label is added by code if the model leaves it out.
- **Model and limits:** free-tier `gemini-3.5-flash-lite`, with `gemini-3.1-flash-lite` as backup. At most 3 model requests per question. Per model, the free tier allowed 15 requests per minute, 250,000 input tokens per minute and 500 requests per day (read from AI Studio on 27 Nov 2026; Google can change this). A question used about 5,400 to 6,800 input tokens per request. When quota runs out the app says so; there are no canned answers.
- **Key:** server-side only.
- **Privacy:** the app warns that on the free tier Google may use questions and replies to improve its products and that people may review them. All data here is made up.

## 10. Setup

Needs Node.js, Python with `openpyxl` (for the Excel workflow), a Supabase project, a Cloudflare account and a Google AI Studio key.

```bash
npm install
cp .env.example .env.local      # fill it in; never commit it
npm run dev                     # local
npm test                        # tests
```

**Environment variable names** (values never go in the repo):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (local scripts only), `GEMINI_API_KEY` (server only; a Cloudflare secret when deployed), `GEMINI_MODELS` (optional), `NEXT_PUBLIC_AUTH_MODE`, `NEXT_PUBLIC_DEMO_PASSWORD`.

**Database, new project, in this order.** SQL files are in `supabase/`; paste each whole file into the Supabase SQL editor.
1. `schema.sql`. **Only on an empty project: it drops every table.**
2. `node scripts/import.mjs` (loads `data/seed`; resets edits and tasks).
3. `patch_session3a.sql`.
4. Set `NEXT_PUBLIC_DEMO_PASSWORD`, then `node scripts/setup_logins.mjs`. Turning off public sign-up is advised.
5. Set `NEXT_PUBLIC_AUTH_MODE=on`, deploy, and sign in once.
6. `patch_session3b.sql`, then `node scripts/setup_logins.mjs --check-only --expect-locked`.
7. `patch_session3c_sponsor.sql`, then `node scripts/import_sponsor.mjs`.
8. `patch_session3d_tickets.sql`.
9. `patch_session3e_scale.sql`.
10. The two-dataset patch, `patch_session4_datasets.sql`.

(`patch_seed_defaults.sql` is only for databases created before that fix; `schema.sql` already includes it. This is the order the live database was built in; it has not been replayed on a second empty project.)

**Load data from Excel** (see [`DATA_GUIDE.md`](DATA_GUIDE.md)):
```bash
npm run data:check -- --dataset simulated   # reports problems; changes nothing
npm run data:load -- --dataset simulated    # checks, asks you to type REPLACE SIMULATED, then replaces that dataset
npm run data:program                        # the program (venues, sessions) for the original dataset; resets nothing
```
`data:load` requires `--dataset original` or `--dataset simulated` (`data:check` checks the original unless told otherwise) and asks for `REPLACE ORIGINAL` or `REPLACE SIMULATED`. **A load clears that dataset's edits, tasks and tickets and never touches the other one.** Run `data:program` again after the program workbook or the map coordinates change.

**Deploy:** `npm run deploy` only. **Never run a bare `wrangler deploy`.** The script patches the Windows build, checks that the server chunks are in the bundle, and removes non-public local environment values from it before deploying. A git push does **not** deploy. Set server secrets with `wrangler secret put`.

## 11. Tools and plans used

| Tool | Plan | Used for |
|---|---|---|
| Next.js 16, React 19, TypeScript | open source | App |
| Cloudflare Workers via OpenNext | Free | Hosting and the model proxy |
| Supabase (Postgres, Auth) | Free | Data, sign-in, saved changes and chats |
| Google AI Studio, Gemini Flash-Lite | Free tier | Copilot model |
| Zustand, zod, Recharts, lucide-react, Tailwind CSS | open source | State, validation, charts, icons, styling |
| Vitest | open source | Tests |
| Python and openpyxl | open source | Excel conversion, model, independent checks |
| Claude Code | AI coding assistant | Research, code, tests, model script, deck build and this README, under my direction and decisions |
| PowerPoint, Canva, Poppins | | Deck: built as an editable PPTX by script, for import into Canva to add graphics |

- **Reused:** open-source libraries and the two provided datasets. No app template or agent framework; no model-written SQL.
- **Modified:** local build scripts patch a Windows problem in the OpenNext adapter (the build succeeded but every route failed) and strip private environment values from the bundle.
- **Built for this assignment:** the calculation engine, screens, database schema and patches, permissions, copilot loop and tools, number check, Excel checker and loader, program and map, and the growth model.
- **Verified:** section 12.

## 12. Testing

**Oracle tests.** The engine is checked against figures computed from the provided data, including 3,625 identified, 2,800 registered, 2,050 actual attendees and 575 confirmed no-shows, and on changed data (for example, denying one check-in takes 2,050 to 2,049). Sponsor figures at four dates (396 values) matched a separate Python calculation from the workbook.

**Latest run (28 Nov 2026): 327 tests passed, 3 opt-in tests skipped, and the production build (`next build`) succeeded.** The build computer was low on memory and disk space, so the tests were run in a single process.

The suite covers the engine and counting rules, data quality, the Excel checks, paged loading, both datasets kept apart (every SQL file run on an in-memory Postgres), the bet KPIs, map and Championship, the copilot tools on both datasets (no bet figure on the original, no later rows, results under the size limit), the loop against fake model replies (tool errors, request limit, rate limit, backup model, date limit, chat history filter, the dataset line, made-up links), permission rules in the app code, sponsor figures and tickets. Three tests are opt-in because they need the live database or spend model quota.

**Simulated data checks.** A plain-Python calculation (`dataset_gen/independent_check.py`) and the app engine (`dataset_gen/engine_compare.ts`) agree on 412 figures at 15 dates. The generator is seeded; a rerun gives byte-identical workbooks.

**Live checks (27 Nov).** An opt-in live test, run on 26 Nov before sign-in was added, matched the oracles, showed the 2,050 to 2,049 edit, and restored 2,050 on reset. After sign-in was locked, the database permission check passed 98 of 98.

**Real-model results on both datasets (27-28 Nov, 31 questions, graded by hand; full table in [`docs/eval/RESULTS.md`](docs/eval/RESULTS.md)).**
- `gemini-3.5-flash-lite` answered all 31. Every simulated figure asked for matched the independent calculation: 10,969 actual attendees and 3,500 on both days; K03 2,345 contingent registrations (Change); the overbooked standup E004 at 909 bookings for 900 seats on 3 April; Kiran College of Commerce (CL003) winning with 398 points and 156 contingent attendees; 336 exam claims, 241 approved, INR 1,19,016 refunded; K11 lock-in 82.9% (Change). On the original data it said seat, bet and Championship records do not exist and gave no figure. It refused hindsight on both datasets.
- Wrong in that run, both fixed in code and re-asked: a "ranked 1 with 0 points" Championship leader before any result (the tool no longer ranks then), and a typed fake link (made-up links now lose their address). Still wrong after the run: in the demo workflow, "create a task to act on that" drafted a task about campaign cost flags instead of the squad bet; and the edit request described the button instead of calling it.
- The backup `gemini-3.1-flash-lite` answered 29 (2 "model busy") and often skipped the tools. As a result it wrongly said claim approvals, both-day attendance and ticket details were not available, and it typed a task as text. The number check caught each figure it made up.

**Earlier real-model results (27 Nov, 13-question set on the original data, graded by hand).**
- First `gemini-3.5-flash-lite` run was **wrong** on several: no answer to a both-days / peak-hour question, 530 instead of 550 no-shows, an invented new total of 755 after a pre-event budget cut, a typed fake link instead of a button, and a garbled "INR 19".
- Correct in that run: funnel, edited data, refusing to say why people did not come, refusing hindsight, refusing to treat sponsor values as cash, ignoring a planted instruction, drafting a task, and a budget-move what-if.
- After fixes, the figures on the re-asked questions were right. The funnel, edited-data, sponsor-cash and task questions had been correct before the fixes and were not re-run.
- **Still imperfect:** a follow-up can open with an unsupported "we could have reached 2,325", and a "why" answer can list show-up differences without calling them associations.
- The backup `gemini-3.1-flash-lite` was weaker: a wrong admissions count, attendees mislabelled as confirmed registrants, and its own arithmetic.
- The number check flagged several real errors with no false alarm seen, but **missed** a wrong 458 and a mislabelled 304, plus one computed percentage.

## 13. Known limitations

**The target**
- 66.7% of base registrations (70.2% in stretch) rest on assumed contingent and unpaid lines. With 40 colleges and no unpaid pull, base falls to 6,411.
- Every paid-funnel rate is assumed: 2025 has no price data. A pre-book rate 30 points under plan gives 6,542.
- Referrals, Community Groups and Organic Search at 3x to 6x their 2025 volume may saturate sooner than modelled.
- Spring Fest figures are private records from an older, three-day, differently priced fest; they show feasibility, not conversion.
- The two college counts date from different times; the NCR-outside-Delhi pool is assumed; competing fests were not researched; hostel capacity is not modelled.
- Ranks 2 and 3 swap at a 15% two-step uplift, and Confidence and Ease are judgement.
- The A/B tests may be too small to prove the effects they look for.

**Evidence and data**
- Every 2025 comparison is association, not cause. Neither dataset records **why** anyone did not attend.
- The simulated run is invented. It shows how the tools behave and proves nothing about whether the bets work.
- The program lineup is illustrative; nobody named is booked or affiliated. The campus is fictional.
- The hackathon is a **simulated scenario that RISA Labs has not agreed to**.

**Product**
- Free tiers: Gemini daily and per-minute limits can stop the copilot (screens keep working); Cloudflare Workers Free has tight CPU limits, so calculations run in the browser; Supabase Free has database and monthly download limits and **pauses a project after a week without use**.
- First load can be slow. Under unexplained slow spells during testing, some loads took 15 to 47 seconds.
- **Anyone with the link can use any demo account,** including Reviewer, so they can edit or reset the demo data and use up the model quota. Use Reset to restore it, and put no personal information in the app.
- The copilot can still be wrong. The number check cannot detect a real number used wrongly. Check important figures against the dashboard. It still does small sums the rules forbid (the check flags them), can drift to another topic on a vague follow-up such as "act on that", and sometimes describes the "Take me there" button instead of showing it.
- Each question sends about 7,300 to 8,700 input tokens (the summary now includes the bet verdicts and the tool list has 24 tools), so a full day's free quota is about 500 model requests, roughly 200 to 250 questions per model.
- The simulated run is one seeded story. The copilot's simulated answers were checked against it, not against other simulated stories.
- **Not verified:** the ticket permission checks on the real database; the database test for saved chats; Reset on the simulated run at its full size; signed-in screens on the live site for the map, bet tracker, Championship and the copilot on the simulated run (checked on a local stand-in and through the real-model eval, which reads the live data without signing in).
