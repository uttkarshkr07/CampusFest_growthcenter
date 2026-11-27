"""CampusFest 2025 slide 1 / slide 2 model. Run from the repo root: python -I docs/model_calc.py
Tags: [S] sourced (dataset, user's Spring Fest records, link, or P1 program), [A] assumption.
Every number on the slides must come from this script's output."""

# ---------------- 2025 baseline [S: original attendee dataset] ----------
#        spend INR, registered, attended
CH25 = {
    "C01 Campus Ambassadors": (42000, 520, 390),
    "C02 Paid Social": (93000, 680, 340),
    "C03 Creator Partners": (59000, 350, 175),
    "C04 College Partnerships": (31000, 450, 385),
    "C05 Student Referrals": (19000, 350, 275),
    "C06 Organic Search": (14000, 250, 195),
    "C07 Community Groups": (16000, 200, 165),
}
# Engine's exact INR per actual attendee [S: original attendee dataset, app engine]
INR_PER_ATT_25 = {"C01": 108, "C02": 274, "C03": 337, "C04": 81, "C05": 69, "C06": 72, "C07": 97}
IDENTIFIED_25, REGISTERED_25, ATT_REG_25, WALKIN_25, ATTENDEES_25 = 3625, 2800, 1925, 125, 2050
SPEND_25 = 274000
CONFIRMED_EXT_25 = 2500
DAY1_ADMIT_25 = 1905

# ---------------- Budget [S: user cap about INR 10L] -------------------------------------
BUDGET_CAP = 1_000_000
# Bet operating costs inside the cap [A]
BET_COSTS = {
    "B1 Contingents": {"visits to 100 colleges x INR 1,500": 150000, "two trophies, head kits, OD letter printing": 70000},
    "B3 Two-step payment": {"2,000 wristbands x INR 30": 60000, "wallet credit 200 x 100 + 300 x 50": 35000,
                            "payment and lock-in messages": 15000},
    "B2 Squad Pass": {"squad promotion creatives": 40000},
    "B5 Hackathon": {"fest-side publicity (prizes and ops sponsor funded, SIMULATED)": 25000},
    "B4 Attendance Exchange": {"claim-window SMS and WhatsApp": 10000},
}
BET_COST_TOTAL = sum(sum(v.values()) for v in BET_COSTS.values())
MEDIA = BUDGET_CAP - BET_COST_TOTAL
# Media allocation [A]. C04 is not here: the contingent bet replaces it (no double count).
ALLOC = {"C01 Campus Ambassadors": 140000, "C02 Paid Social": 80000, "C03 Creator Partners": 40000,
         "C05 Student Referrals": 135000, "C06 Organic Search": 60000, "C07 Community Groups": 140000}
assert sum(ALLOC.values()) == MEDIA, (sum(ALLOC.values()), MEDIA)

# ---------------- Scenario inputs --------------------------------------------------------
SC = {
    "base": dict(
        marginal=2.0,                       # [A] cost of each registration above 2025 spend, x 2025 average
        colleges=70, size=100,              # [A] colleges x average contingent; sizes 50-200 [S: Spring Fest]
        organic=3000,                       # [A] unpaid sign-ups pulled by lineup, brand, word of mouth
        squad_share=0.25,                   # [A] share of non-contingent registrations in squads of 5
        # paid funnel [A]: registered -> pre-booked -> locked-in -> attended
        ind=(0.70, 0.85, 0.90), squad=(0.80, 0.88, 0.94), cont=(0.85, 0.92, 0.92),
        two_step_uplift=0.08,               # [A] relative lift in registered->attended vs one-step payment
        cannibal=0.25,                      # [A] share of contingent registrants who would have signed up anyway
        squad_causal=0.50,                  # [A] share of squad-vs-individual gap caused by the pass (rest is selection)
        squad_extra=0.20,                   # [A] share of squad registrants who would not have registered otherwise
        hack_participants=150,              # [S: draft ticket, SIMULATED SCENARIO]
        hack_overlap=0.30,                  # [A] hackathon people already among registrants
    ),
}
SC["stretch"] = dict(SC["base"], marginal=1.5, colleges=90, size=120, organic=3250, squad_share=0.30,
                     ind=(0.75, 0.88, 0.92), squad=(0.85, 0.90, 0.95), cont=(0.88, 0.93, 0.93),
                     two_step_uplift=0.10, hack_overlap=0.20)

GATE_RATE = WALKIN_25 / ATT_REG_25          # [S] walk-ins per registered attendee in 2025
PASS_CAP = 13000                            # [A, user decision] external passes
GROUND = 20000                              # [S: user] Pronite ground per night
SAFE_FILL, INTERNAL_ON_GROUND = 0.90, 5000  # [A] host students, staff, guests
ACCOM_SHARE = 0.15                          # [A]
PRICE_N, PRICE_A, BOOK_N, BOOK_A = 500, 1500, 99, 299   # [S: user's bet notes]
CLAIM_RATE = 0.03                           # [A, user decision]
VOID_RESOLD = 0.60                          # [A] voided passes refilled via the exchange when the cap binds
FULL_SQUAD_RATE = 0.70                      # [A] squads where all 5 check in
DISC_PER_CONT = {"base": 10, "stretch": 25} # [A] members who get the 25% cheer-squad price per contingent
# Festival program [S: simulated festival schedule]
STANDUP_SHOWS, STANDUP_SEATS, BOOKABLE_SESSIONS, BOOKABLE_SEATS = 4, 3200, 31, 16350
STANDUP_SEATS_PER_DAY = 1600
BLEND_25 = ATT_REG_25 / REGISTERED_25
ALL_BETS = ("B1", "B3", "B2", "B5", "B4")  # same order as the BET_COSTS keys; IDs are ICE ranks


def media_lines(marginal):
    out = []
    for name, spend in ALLOC.items():
        s25, r25, a25 = CH25[name]
        cpr = s25 / r25
        regs = spend / cpr if spend <= s25 else r25 + (spend - s25) / (cpr * marginal)
        index = (a25 / r25) / BLEND_25       # [S] channel show-up relative to 2025 blended
        out.append((name, spend, regs, index))
    return out


def prod(t):
    return t[0] * t[1] * t[2]


def run(name, bets=ALL_BETS, sc=None, cap=PASS_CAP):
    p = sc or SC[name]
    m = media_lines(p["marginal"])
    media_regs = sum(x[2] for x in m)
    idx = sum(x[2] * x[3] for x in m) / media_regs
    pool = media_regs + p["organic"]
    pool_idx = (media_regs * idx + p["organic"]) / pool
    cont_all = p["colleges"] * p["size"]

    squad_regs = pool * p["squad_share"]
    ind_regs = pool - squad_regs
    ind_rate = prod(p["ind"]) * pool_idx
    squad_rate = prod(p["squad"]) * pool_idx
    if "B2" not in bets:
        # without the pass: extra sign-ups vanish, the causal part of the rate gap vanishes
        squad_regs *= (1 - p["squad_extra"])
        squad_rate -= p["squad_causal"] * (squad_rate - ind_rate)

    if "B1" in bets:
        cont_regs, cont_rate = cont_all, prod(p["cont"])
    else:
        cont_regs, cont_rate = cont_all * p["cannibal"], ind_rate

    f = 1.0 if "B3" in bets else 1 / (1 + p["two_step_uplift"])
    routes = {"individual": (ind_regs, ind_rate * f), "squad": (squad_regs, squad_rate * f),
              "contingent": (cont_regs, cont_rate * f)}
    from_regs = sum(r * k for r, k in routes.values())
    gate = from_regs * GATE_RATE
    hack = p["hack_participants"] * (1 - p["hack_overlap"]) if "B5" in bets else 0
    demand = from_regs + gate + hack
    attendees = min(demand, cap)
    refill = 0
    if demand > cap:  # cap binds: exam-claim voids leave empty passes unless resold
        voided = cap * CLAIM_RATE
        lost = voided * (1 - (VOID_RESOLD if "B4" in bets else 0))
        refill = voided * VOID_RESOLD if "B4" in bets else 0
        attendees = cap - lost
    return dict(p=p, media=m, media_regs=media_regs, idx=idx, pool=pool, pool_idx=pool_idx,
                routes=routes, regs=sum(r for r, _ in routes.values()), from_regs=from_regs,
                gate=gate, hack=hack, demand=demand, attendees=attendees, refill=refill)


def n(x):
    return f"{x:,.0f}"


def pct(x):
    return f"{x*100:.1f}%"


def H(t):
    print(f"\n=== {t} ===")


H("2025 baseline [S]")
print(f"identified {n(IDENTIFIED_25)} | registered {n(REGISTERED_25)} ({pct(REGISTERED_25/IDENTIFIED_25)} of identified) | "
      f"confirmed external {n(CONFIRMED_EXT_25)} | registered attendees {n(ATT_REG_25)} + walk-ins {WALKIN_25} = {n(ATTENDEES_25)}")
print(f"registered->attended {pct(BLEND_25)} | spend INR {n(SPEND_25)} | INR per attendee {n(SPEND_25/ATTENDEES_25)} | "
      f"INR per registration {n(SPEND_25/REGISTERED_25)}")
print(f"gate/walk-in rate {pct(GATE_RATE)} | day 1 share of attendees {pct(DAY1_ADMIT_25/ATTENDEES_25)}")
for k, (s, r, a) in CH25.items():
    print(f"  {k}: spend {n(s)} regs {r} attended {a} show-up {pct(a/r)} INR/attendee {INR_PER_ATT_25[k[:3]]}")

H("Budget (INR) [cap S, split A]")
for bet, items in BET_COSTS.items():
    print(f"{bet}: {n(sum(items.values()))}  " + "; ".join(f"{k} {n(v)}" for k, v in items.items()))
print(f"bet operating total {n(BET_COST_TOTAL)} | channel media {n(MEDIA)} | total {n(BUDGET_CAP)}")

R = {s: run(s) for s in SC}
for s, r in R.items():
    p = r["p"]
    H(f"{s.upper()}: registrations")
    print(f"channel media ({p['marginal']}x marginal above 2025 spend):")
    for name, spend, regs, index in r["media"]:
        att = regs * prod(p['ind']) * index * (1 + GATE_RATE)
        print(f"  {name}: INR {n(spend)} -> regs {n(regs)} ({regs/CH25[name][1]:.1f}x 2025) | show-up index {index:.2f} | "
              f"INR/actual attendee {n(spend/att)} (individual-route funnel)")
    cont = p["colleges"] * p["size"]
    print(f"a) paid+owned channels {n(r['media_regs'])} | b) contingents {p['colleges']} colleges x {p['size']} = {n(cont)} | "
          f"c) organic lineup pull {n(p['organic'])} | TOTAL {n(r['regs'])}")
    print(f"share from contingents {pct(cont/r['regs'])} | from organic {pct(p['organic']/r['regs'])} | both {pct((cont+p['organic'])/r['regs'])}")
    print(f"identified people needed for a)+c) at 2025 identified->registered: {n(r['pool']/(REGISTERED_25/IDENTIFIED_25))}")
    H(f"{s.upper()}: funnel by route (squads {int(r['routes']['squad'][0]/5)} of 5)")
    tp = tl = 0
    for route, (regs, rate) in r["routes"].items():
        key = {"individual": "ind", "squad": "squad", "contingent": "cont"}[route]
        pb, lk, sh = p[key]
        att = regs * rate
        locked = att / sh
        prebooked = locked / lk
        tp += prebooked; tl += locked
        print(f"  {route}: registered {n(regs)} -> pre-booked {n(prebooked)} ({pct(prebooked/regs)}) -> locked-in {n(locked)} "
              f"({pct(locked/prebooked)}) -> attended {n(att)} ({pct(sh)} show-up); registered->attended {pct(rate)}")
    r["prebooked"], r["locked"] = tp, tl
    print(f"  all routes: registered {n(r['regs'])} -> pre-booked {n(tp)} -> locked-in {n(tl)} -> attended {n(r['from_regs'])}")
    print(f"  + gate buyers/walk-ins {n(r['gate'])} + hackathon net new {n(r['hack'])} = demand {n(r['demand'])}")
    binds = r["demand"] > PASS_CAP
    print(f"  pass cap {n(PASS_CAP)} {'BINDS' if binds else 'does not bind'} | exchange refill {n(r['refill'])}")
    att = r["attendees"]
    print(f"  >>> {s.upper()} ACTUAL ATTENDEES {n(att)} ({att/ATTENDEES_25:.1f}x 2025) | of registrations {pct(att/r['regs'])}")
    print(f"  marketing+ops INR per actual attendee {n(BUDGET_CAP/att)} (2025: {n(SPEND_25/ATTENDEES_25)})")

H("Bridge from 2025 to target (sequential, in bet rank order)")
ORDER = ["B1", "B2", "B3", "B4", "B5"]   # ICE order, computed below
LABEL = {"B1": "Contingents", "B3": "Two-step payment", "B2": "Squad Pass", "B5": "Hackathon", "B4": "Attendance Exchange"}
INC = {}
for s in SC:
    none = run(s, bets=())
    print(f"{s}: 2025 actual {n(ATTENDEES_25)} -> scale-up without bets (channels + organic + anyway-contingent) "
          f"+{n(none['attendees']-ATTENDEES_25)} = {n(none['attendees'])}")
    prev, on, seq = none["demand"], [], {}
    for b in ORDER:
        if b == "B4":
            continue
        on.append(b)
        cur = run(s, bets=tuple(on), cap=10**9)["demand"]
        seq[b] = cur - prev
        print(f"   + {b} {LABEL[b]}: {seq[b]:+,.0f} -> {n(cur)} (before pass cap)")
        prev = cur
    full = R[s]
    capline = min(full["demand"], PASS_CAP) - prev
    voided = (full["attendees"] - full["refill"]) - min(full["demand"], PASS_CAP)
    print(f"   pass cap {n(PASS_CAP)}: {capline:+,.0f} | exam-claim voided passes when sold out: {voided:+,.0f} | "
          f"+ B4 exchange refill: {full['refill']:+,.0f} | = {n(full['attendees'])}")
    seq["B4"], seq["cap"], seq["void"] = full["refill"], capline, voided
    assert abs(prev + capline + voided + full["refill"] - full["attendees"]) < 0.01
    # leave-one-out = each bet measured as if added last; summing these double-counts shared people
    unc = {b: run(s, cap=10**9)["demand"] - run(s, bets=tuple(x for x in ALL_BETS if x != b), cap=10**9)["demand"] for b in ALL_BETS}
    net_unc = run(s, cap=10**9)["demand"] - run(s, bets=(), cap=10**9)["demand"]
    INC[s] = dict(seq=seq, loo=unc, none=none["attendees"])
    print(f"   leave-one-out (no cap): " + ", ".join(f"{b} {n(v)}" for b, v in unc.items()))
    print(f"   gross sum {n(sum(unc.values()))} | overlap/interaction removed {sum(unc.values())-net_unc:+,.0f} | net from bets (no cap) {n(net_unc)}")
    print(f"   net from bets after cap {n(R[s]['attendees']-none['attendees'])}")
    cann = SC[s]["colleges"] * SC[s]["size"] * SC[s]["cannibal"]
    print(f"   contingent registrants assumed to sign up anyway (not credited to B1): {n(cann)}")

H("Cost per incremental attendee by bet (operating cost only, base leave-one-out)")
for b_, key in zip(ALL_BETS, BET_COSTS):
    cost = sum(BET_COSTS[key].values()); v = INC["base"]["loo"][b_]
    print(f"  {key}: INR {n(cost)} / {n(v)} = " + (f"INR {n(cost/v)}" if v >= 1 else "no distinct attendees in base"))
for s_, r_ in R.items():
    media_att = sum(x[2] * prod(r_["p"]["ind"]) * x[3] for x in r_["media"]) * (1 + GATE_RATE)
    print(f"  {s_} paid+owned channels blended: INR {n(MEDIA)} / {n(media_att)} = INR {n(MEDIA/media_att)} per actual attendee (individual-route funnel)")
print("Contingent college funnel [A]: 100 colleges visited -> 70 signed (base) / 90 signed (stretch, aggressive); "
      "universe: DU 91 colleges + GGSIPU 107 institutes [S] = 198")

H("Stress test on the contingent line")
ca = R["base"]["routes"]["contingent"][0] * R["base"]["routes"]["contingent"][1]
print(f"base contingent attendees {n(ca)}; bought at 2025 C04 INR {INR_PER_ATT_25['C04']} x 2.0 marginal = INR {INR_PER_ATT_25['C04']*2} each = INR {n(ca*INR_PER_ATT_25['C04']*2)} "
      f"(does not fit in INR {n(BUDGET_CAP)}); the plan spends INR {n(sum(BET_COSTS['B1 Contingents'].values()))} because heads recruit and tier discounts come from pass revenue [A]")

H("Opportunity cost of bet spend")
m2 = SC["base"]["marginal"]
cpr_avg = (SPEND_25 - CH25['C04 College Partnerships'][0]) / (REGISTERED_25 - CH25['C04 College Partnerships'][1])
opp_regs = BET_COST_TOTAL / (cpr_avg * m2)
opp_att = opp_regs * prod(SC['base']['ind']) * (1 + GATE_RATE)
print(f"INR {n(BET_COST_TOTAL)} in media instead would buy about {n(opp_regs)} regs / {n(opp_att)} attendees (base); "
      f"bets add {n(R['base']['attendees']-INC['base']['none'])} (base)")

H("ICE (Impact from base leave-one-out; Confidence and Ease are judged scores [A])")
CONF = {"B1": 7, "B3": 4, "B2": 5, "B5": 4, "B4": 4}
EASE = {"B1": 4, "B3": 5, "B2": 8, "B5": 3, "B4": 5}
top = max(INC["base"]["loo"].values())
scores = {}
for b in ALL_BETS:
    imp = 1 + 9 * max(INC["base"]["loo"][b], 0) / top
    scores[b] = imp * CONF[b] * EASE[b]
    print(f"  {b} {LABEL[b]}: impact {imp:.1f} x confidence {CONF[b]} x ease {EASE[b]} = {scores[b]:.0f}")
ranked = sorted(scores, key=scores.get, reverse=True)
print("rank: " + " > ".join(f"{b} {LABEL[b]}" for b in ranked))
assert ranked == ORDER, ("bridge order differs from ICE order", ranked)
for u in (0.08, 0.10, 0.12, 0.15, 0.20):
    sc = dict(SC["base"], two_step_uplift=u)
    v = run("base", sc=sc, cap=10**9)["demand"] - run("base", bets=("B1", "B2", "B5", "B4"), sc=sc, cap=10**9)["demand"]
    s2 = (1 + 9 * v / top) * CONF["B3"] * EASE["B3"]
    print(f"  two-step uplift {pct(u)}: B3 adds {n(v)}, ICE {s2:.0f} vs Squad {scores['B2']:.0f}")

H("Capacity")
safe_ext = GROUND * SAFE_FILL - INTERNAL_ON_GROUND
print(f"safe external per night = {n(GROUND)} x {pct(SAFE_FILL)} - {n(INTERNAL_ON_GROUND)} = {n(safe_ext)}; pass cap {n(PASS_CAP)}")
for s, r in R.items():
    d1 = r["attendees"] * DAY1_ADMIT_25 / ATTENDEES_25
    print(f"  {s}: day 1 external about {n(d1)}, on ground with internal {n(d1+INTERNAL_ON_GROUND)} of {n(GROUND)}")
    assert r["attendees"] <= PASS_CAP and d1 + INTERNAL_ON_GROUND <= GROUND
hi_cap = int(GROUND - INTERNAL_ON_GROUND)
hi = run("stretch", cap=hi_cap)
print(f"stretch unconstrained demand {n(R['stretch']['demand'])}; if cap were {n(hi_cap)} (100% ground) attendees {n(hi['attendees'])}")
print(f"P1 [S]: standup {STANDUP_SHOWS} shows, {n(STANDUP_SEATS)} seats ({n(STANDUP_SEATS_PER_DAY)}/day); "
      f"all bookable {BOOKABLE_SESSIONS} sessions, {n(BOOKABLE_SEATS)} seats; base attendees per standup seat {R['base']['attendees']/STANDUP_SEATS:.1f}")

H("Revenue effects (from pass revenue, NOT marketing budget) [A]")
avg_price = (1 - ACCOM_SHARE) * PRICE_N + ACCOM_SHARE * PRICE_A
avg_ins = (1 - ACCOM_SHARE) * (PRICE_N - BOOK_N) + ACCOM_SHARE * (PRICE_A - BOOK_A)
print(f"average pass INR {n(avg_price)} | average insurable amount INR {n(avg_ins)}")
for s, r in R.items():
    gross = r["attendees"] * avg_price
    squad_att = r["routes"]["squad"][0] * r["routes"]["squad"][1]
    cashback = squad_att * FULL_SQUAD_RATE * 0.20 * avg_price
    disc = SC[s]["colleges"] * DISC_PER_CONT[s] * 0.25 * avg_price
    claims = r["locked"] * CLAIM_RATE
    reserve = claims * avg_ins
    print(f"  {s}: indicative gross pass revenue INR {n(gross)} | squad cashback {n(cashback)} | contingent cheer discount {n(disc)} "
          f"| insurance claims {n(claims)}, reserve {n(reserve)} | total {pct((cashback+disc+reserve)/gross)} of gross")

H("Sensitivity on base (attendees, cap applied)")
def shift(sc, d_lock, d_show):
    out = dict(sc)
    for k in ("ind", "squad", "cont"):
        pb, lk, sh = sc[k]
        out[k] = (pb, lk + d_lock, min(sh + d_show, 0.98))
    return out
for lab, dl, ds in (("low", -0.10, -0.08), ("mid", 0, 0), ("high", 0.05, 0.03)):
    print(f"  lock-in and show-up {lab} ({dl*100:+.0f} / {ds*100:+.0f} pts): {n(run('base', sc=shift(SC['base'], dl, ds))['attendees'])}")
for lab, d in (("pre-book -15 pts", -0.15), ("pre-book -30 pts", -0.30)):
    sc = dict(SC["base"])
    for k in ("ind", "squad", "cont"):
        pb, lk, sh = sc[k]; sc[k] = (pb + d, lk, sh)
    print(f"  {lab}: {n(run('base', sc=sc)['attendees'])}")
for c in (40, 55, 70, 85):
    r = run("base", sc=dict(SC["base"], colleges=c))
    print(f"  {c} colleges: regs {n(r['regs'])}, attendees {n(r['attendees'])}")
r = run("base", sc=dict(SC["base"], organic=0))
print(f"  organic pull zero: regs {n(r['regs'])}, attendees {n(r['attendees'])}")
r = run("base", sc=dict(SC["base"], organic=0, colleges=40))
print(f"  floor (40 colleges, no organic): regs {n(r['regs'])}, attendees {n(r['attendees'])}")

H("Audience segments")
DELHI_REGULAR = 478736     # [S: AISHE 2021-22 Table 6(a)]
DELHI_ALL = 1145390        # [S: AISHE 2021-22 Table 6]
SEG = [  # name, size, size tag, share of base registrations [A]
    ("1 Delhi regular-mode college students", DELHI_REGULAR, "S", 0.66),
    ("2 NCR outside Delhi (Noida, Gurugram, Ghaziabad, Faridabad)", 200000, "A", 0.24),
    ("3 Health x AI (medical, nursing, pharmacy, AI builders; inside 1 and 2)", 40000, "A", 0.05),
    ("4 Outstation competing contingents", 10000, "A", 0.05),
]
assert abs(sum(x[3] for x in SEG) - 1) < 1e-9
for name, size, tag, sh in SEG:
    regs = R["base"]["regs"] * sh
    print(f"  {name}: size {n(size)} [{tag}] | base regs {n(regs)} ({pct(regs/size)} of segment) | "
          f"base attendees about {n(R['base']['attendees']*sh)}")
print(f"Delhi higher-education enrolment all modes {n(DELHI_ALL)}, regular {n(DELHI_REGULAR)}")
print(f"core pool 1+2 = {n(DELHI_REGULAR+200000)}; base registrations need {pct(R['base']['regs']/(DELHI_REGULAR+200000))} of it")

H("Test power (two arms, 80% power, 5% two-sided): smallest detectable gap")
for p0, n_arm in ((0.70, 200), (0.70, 400), (0.70, 800), (0.70, 1500)):
    mde = 2.8 * (2 * p0 * (1 - p0) / n_arm) ** 0.5
    print(f"  baseline {pct(p0)}, {n_arm} per arm: {mde*100:.1f} pts")

H("Checkpoint pace values (base)")
b = R["base"]
print(f"contingent regs base {n(SC['base']['colleges']*SC['base']['size'])}; half = {n(SC['base']['colleges']*SC['base']['size']/2)}")
print(f"squads base {n(b['routes']['squad'][0]/5)}; half = {n(b['routes']['squad'][0]/10)}")
print(f"locked-in base {n(b['locked'])}; pre-booked base {n(b['prebooked'])}; lock/pre-book {pct(b['locked']/b['prebooked'])}; "
      f"pre-book/registered {pct(b['prebooked']/b['regs'])}")

H("Fixed inputs quoted on slides")
print("Spring Fest [S: user's records]: footfall about 30,000 over 3 days | registrations about 25,000 excl. about 10,000 own-college | pass about INR 2,300 | contingents 50-200")
print("2025 show-up evidence [S: original attendee dataset, recomputed 27 Nov]: nurture email opened or clicked 69% vs no email or question 68% | "
      "asked a question 79% | registered in last 4 weeks 72-73% (weekly 69-74%, 72.8% pooled) vs 6-10 weeks out 62-64% (62.7% pooled) | "
      "575 confirmed no-shows, 60 reached the gate (denied or pending) | 88 waitlisted, 0 attended")
print("Delhi NCR metro network 393 km [S: PIB, Dec 2024] | college universe 91 DU colleges + 107 GGSIPU institutes = 198 [S]")
print(f"insurable amounts INR {n(PRICE_N-BOOK_N)} / {n(PRICE_A-BOOK_A)} | Championship total points 1,630 [S: P1] | hackathon support INR 150,000, prizes INR 100,000 (SIMULATED, not received)")

H("Slide 3 thresholds [A]")
print("K03 contingent regs by 15 Mar: scale >= 3,500 (50% of 7,000), change 2,100 to 3,499, stop < 2,100 (30%)")
