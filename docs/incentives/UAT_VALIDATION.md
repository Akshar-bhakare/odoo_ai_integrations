# Sunlectric Incentive Business UAT Validation

Validation date: 2026-08-22. Environment: neutralized Odoo Online 19 test database, company `SUNLECTRIC PRIVATE LIMITED` (`res.company(1)`). This was a read-only business validation run. No wage, accounting record, attribution, preset, assignment, or business rule was changed.

## Executive Result

| Result | Count |
| --- | ---: |
| PASS | 22 |
| FAIL | 0 |
| Total | 22 |

The required A-Q matrix and all four clarified cross-owner new-customer count scenarios pass. The previous `N-GLOBAL` failure was an incorrect UAT expectation: `company_global` governs customer history and customer qualification, while `minimumQualifyingCustomers` is applied separately to each employee's monthly group after ownership attribution.

## Test Population

- Primary employee: Aditya Ashok Munde, `hr.employee(4)`, current wage ₹20,000, `hr.version(4)` effective 2025-11-23.
- Adjustment fixture: Ankita Gaur, `hr.employee(1)`, wage ₹20,000, approved Phase 5 calculation 2.
- Standard configuration: Flat; 6x salary threshold = ₹120,000; carry enabled; 10%; entire eligible base; include previous unpaid base.
- Controlled cases use the real ₹20,000 wage and approved schema 1.0 rules but synthetic normalized amounts in future month 2098. They do not create Odoo records.
- Live cases K-O use posted Odoo accounting/customer data. Case P uses retained approved Odoo snapshots.

## Result Matrix

| ID | Test | Result | Classification / note |
| --- | --- | --- | --- |
| A | Flat + no carry | PASS | Matches approved behavior |
| B | Flat + carry | PASS | Matches approved behavior |
| C | Flat + previous base included | PASS | Prior unpaid base paid once |
| D | Flat + previous base excluded | PASS | Current month only |
| E | Flat + above-threshold-only | PASS | Only excess base paid |
| F | Slab + no carry | PASS | Highest matching slab, whole base |
| G | Slab + carry | PASS | Carry excluded from slab selection |
| H | Fixed-amount slabs | PASS | Highest threshold wins |
| I | Salary-multiple slabs | PASS | Uses ₹20,000 first-day wage |
| J | Negative Actual Base | PASS | Carry increases |
| K | Employee expense | PASS | Posted expense deducted once |
| L | Commission | PASS | Assigned account 211810 amount deducted once |
| M | Credit note | PASS | Signed Sales/COGS counted once; accounting data question remains |
| N | Real new-customer bonus | PASS | Three qualifying customers owned by employee 4 |
| N-COUNT-2-1 | Global count 3, owner split 2/1 | PASS | Neither employee meets minimum 3 |
| N-COUNT-3-1 | Global count 4, owner split 3/1 | PASS | Only employee with 3 qualifies |
| N-COUNT-3-3 | Global count 6, owner split 3/3 | PASS | Both employees qualify |
| N-COUNT-4-2 | Global count 6, owner split 4/2 | PASS | Only employee with 4 qualifies |
| O | Real repeat bonus | PASS | Event owner and one-payout limit applied |
| O-RULES | Repeat GM/window boundaries | PASS | Low GM and day 91 rejected; day 90 accepted |
| P | Adjustment | PASS | Raw + additions - deductions = final |
| Q | Notice streak | PASS | Triggers on fourth failed month |

## A. Flat + No Carry — PASS

- **Input:** Aditya; 2098-01; UAT Flat No Carry/schema 1.0; wage ₹20,000; Sales ₹80,000; all other accounting amounts zero; Actual Base ₹80,000; carry disabled.
- **Expected business result:** 6x threshold is ₹120,000. Threshold fails, incentive is zero, and no shortfall is retained.
- **Actual system result:** Employee Aditya; wage ₹20,000; Sales ₹80,000; COGS ₹0; GM ₹80,000; transport/loading ₹0/₹0; adjusted GM ₹80,000; expenses/commission ₹0/₹0; Actual Base ₹80,000; Flat threshold ₹120,000; carry in/out ₹0/₹0; required ₹120,000; carry consumed ₹0; eligible base ₹0; rate none; main/new/repeat ₹0/₹0/₹0; adjustments ₹0; final ₹0; notice No.
- **Explanation:** `₹80,000 GM - ₹0 deductions = ₹80,000 Actual Base`; `₹80,000 < ₹120,000`; carry is disabled.
- **Sources:** Controlled normalized UAT input; `hr.employee(4)` wage ₹20,000; no Odoo mutation.

## B. Flat + Carry — PASS

- **Input:** Aditya; 2098-01 base ₹80,000 followed by 2098-02 base ₹160,000; Flat; carry enabled; current-month-only payout.
- **Expected business result:** Month 1 carry is ₹40,000. Month 2 required threshold is ₹160,000 and consumes ₹40,000 carry. Current ₹160,000 earns 10% = ₹16,000.
- **Actual system result:** Month 2098-02; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹160,000; COGS, transport, loading, expenses, commission ₹0; Flat threshold ₹120,000; carry in ₹40,000; carry out ₹0; required ₹160,000; carry consumed ₹40,000; eligible base ₹160,000; achieved rate 10%; main ₹16,000; customer bonuses/adjustments ₹0; final ₹16,000; notice No.
- **Explanation:** `Month 1 carry = ₹120,000 - ₹80,000 = ₹40,000`; `Month 2 required = ₹120,000 + ₹40,000 = ₹160,000`; `₹160,000 x 10% = ₹16,000`.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## C. Flat + Previous Base Included — PASS

- **Input:** Aditya; Month 1 base ₹80,000; Month 2 base ₹160,000; carry and previous unpaid base enabled.
- **Expected business result:** Month 2 satisfies required ₹160,000. Previous ₹80,000 plus current ₹160,000 gives eligible base ₹240,000 and ₹24,000 incentive. Accumulated base resets.
- **Actual system result:** 2098-02; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹160,000; all deductions zero; Flat threshold ₹120,000; carry in ₹40,000; required ₹160,000; carry consumed ₹40,000; previous unpaid base in ₹80,000/out ₹0; eligible base ₹240,000; rate 10%; main/final ₹24,000; bonuses/adjustments ₹0; notice No.
- **Explanation:** `Eligible = ₹80,000 prior unpaid + ₹160,000 current = ₹240,000`; `₹240,000 x 10% = ₹24,000`. Reset prevents double payment.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## D. Flat + Previous Base Excluded — PASS

- **Input:** Same ₹80,000 then ₹160,000 sequence; previous-base payout set to current month only.
- **Expected business result:** Carry still raises Month 2 requirement to ₹160,000, but prior ₹80,000 is not paid. Incentive is ₹16,000.
- **Actual system result:** 2098-02; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹160,000; deductions zero; Flat threshold ₹120,000; carry in/consumed ₹40,000/₹40,000; required ₹160,000; accumulated unpaid base in/out ₹0/₹0; eligible base ₹160,000; rate 10%; main/final ₹16,000; bonuses/adjustments ₹0; notice No.
- **Explanation:** `₹160,000 current base x 10% = ₹16,000`; no historical base enters the payout base.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## E. Flat + Above-Threshold-Only — PASS

- **Input:** Aditya; 2098-01; Actual Base ₹200,000; threshold ₹120,000; carry off; current-month-only; above-threshold payout.
- **Expected business result:** Only ₹80,000 above threshold earns 10%, producing ₹8,000.
- **Actual system result:** wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹200,000; other accounting fields zero; Flat threshold/required ₹120,000/₹120,000; carry in/out/consumed ₹0; eligible base ₹80,000; rate 10%; main/final ₹8,000; new/repeat/adjustments ₹0; notice No.
- **Explanation:** `(₹200,000 - ₹120,000) x 10% = ₹8,000`.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## F. Slab + No Carry — PASS

- **Input:** Aditya; fixed slabs ₹120k@10%, ₹150k@12.5%, ₹180k@15%, ₹200k@20%; Actual Base ₹170,000; carry off.
- **Expected business result:** ₹150,000 slab is highest match. Whole ₹170,000 earns 12.5% = ₹21,250.
- **Actual system result:** 2098-01; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹170,000; COGS/deductions ₹0; Slab first threshold ₹120,000; required ₹120,000; carry ₹0; selection/eligible base ₹170,000; achieved rate 12.5%; main/final ₹21,250; bonuses/adjustments ₹0; notice No.
- **Explanation:** ₹170,000 is above ₹150,000 but below ₹180,000; V1 applies the achieved rate to the whole eligible base, not progressively.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## G. Slab + Carry — PASS

- **Input:** Fixed slabs above; Month 1 base ₹80,000; Month 2 base ₹160,000; carry enabled.
- **Expected business result:** Month 1 carry ₹40,000. Month 2 satisfies required ₹160,000, but carry is removed before slab selection. Recognized base ₹120,000 earns 10% = ₹12,000.
- **Actual system result:** 2098-02; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹160,000; deductions zero; first slab ₹120,000; carry in/out ₹40,000/₹0; required ₹160,000; carry consumed ₹40,000; recognized/selection/eligible base ₹120,000; rate 10%; main/final ₹12,000; prior-base accumulation ₹0; bonuses/adjustments ₹0; notice No.
- **Explanation:** `₹160,000 current - ₹40,000 consumed carry = ₹120,000 slab performance`; prior month ₹80,000 does not raise the slab.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## H. Fixed-Amount Slabs — PASS

- **Input:** Fixed thresholds ₹120k/₹150k/₹180k/₹200k; Actual Base ₹205,000; carry off.
- **Expected business result:** Highest matching ₹200,000 slab at 20% applies to the whole ₹205,000, giving ₹41,000.
- **Actual system result:** 2098-01; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹205,000; COGS and deductions zero; first slab/required ₹120,000; carry ₹0; slab selection/eligible ₹205,000; achieved rate 20%; main/final ₹41,000; bonuses/adjustments ₹0; notice No.
- **Explanation:** `₹205,000 x 20% = ₹41,000`; no progressive calculation is used.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## I. Salary-Multiple Slabs — PASS

- **Input:** Wage ₹20,000; thresholds 3x@10%, 3.5x@12.5%, 4x@15%; Actual Base ₹75,000; carry off.
- **Expected business result:** Resolved thresholds are ₹60,000/₹70,000/₹80,000. ₹70,000 is highest match, so ₹75,000 earns 12.5% = ₹9,375.
- **Actual system result:** 2098-01; wage ₹20,000; Sales/GM/adjusted GM/Actual Base ₹75,000; other accounting fields zero; first slab/required ₹60,000; carry ₹0; selection/eligible ₹75,000; rate 12.5%; main/final ₹9,375; bonuses/adjustments ₹0; notice No.
- **Explanation:** Salary is resolved on the first calendar day with no proration; `₹20,000 x 3.5 = ₹70,000`.
- **Sources:** Controlled normalized UAT input using ₹20,000 wage; no Odoo mutation.

## J. Negative Actual Base — PASS

- **Input:** Aditya; Actual Base -₹70,000; standard threshold ₹120,000; carry enabled.
- **Expected business result:** Negative base is allowed. Carry becomes ₹190,000 and incentive remains zero.
- **Actual system result:** 2098-01; wage ₹20,000; Sales/GM/adjusted GM/Actual Base -₹70,000; COGS/deductions zero; Flat threshold/required ₹120,000; carry in ₹0/out ₹190,000; carry consumed ₹0; eligible base ₹0; no rate; main/customer/adjustment/final ₹0; notice No; accumulated unpaid base out -₹70,000.
- **Explanation:** `Carry = ₹120,000 - (-₹70,000) = ₹190,000`.
- **Sources:** Controlled normalized UAT input; no Odoo mutation.

## K. Employee Expense Deduction — PASS

- **Input:** Live Aditya December 2025 accounting and posted employee expenses totaling ₹4,242.
- **Expected business result:** Adjusted GM ₹1,647,341.15 less expenses ₹4,242 gives Actual Base ₹1,643,099.15; 10% main incentive ₹164,309.92.
- **Actual system result:** Standard/schema 1.0; wage ₹20,000; Sales ₹15,978,462.50; COGS ₹14,331,121.35; GM ₹1,647,341.15; transport/loading ₹0; adjusted GM ₹1,647,341.15; expenses ₹4,242; commission ₹0; Actual Base ₹1,643,099.15; Flat threshold/required ₹120,000; carry in/out/consumed ₹0; eligible base ₹1,643,099.15; rate 10%; main/final ₹164,309.92; customer bonuses/adjustments ₹0; notice No.
- **Explanation:** `₹15,978,462.50 - ₹14,331,121.35 = ₹1,647,341.15 GM`; `GM - ₹4,242 = ₹1,643,099.15`; expense is counted once.
- **Sources:** `account.move.line(7324,7391,7393,7595,7597,7599,7601,7603,7605,7607,7609)` linked to moves `2373,2386,2387,2458-2465`; signed amounts total ₹4,242.

## L. Commission Deduction — PASS

- **Input:** Live January baseline for Aditya; real account 211810 line ₹49,926 modeled with authoritative employee assignment.
- **Expected business result:** Commission reduces baseline Actual Base ₹389,168.54 once, resulting in ₹339,242.54 and main incentive ₹33,924.25.
- **Actual system result:** Standard/schema 1.0; wage ₹20,000; Sales ₹14,560,361.50; COGS ₹14,171,192.96; GM/adjusted GM ₹389,168.54; transport/loading/expenses ₹0; commission ₹49,926; Actual Base ₹339,242.54; threshold/required ₹120,000; carry ₹0; eligible ₹339,242.54; rate 10%; main/final ₹33,924.25; bonuses/adjustments ₹0; notice No.
- **Explanation:** `₹389,168.54 - ₹49,926 = ₹339,242.54`. Without attribution, the source remains unresolved and is not deducted or guessed.
- **Sources:** `account.move.line(9100)`, `account.move(2935)` `BILL/25-26/01/0021`, account `211810 Sales Commission Expense`.

## M. Credit-Note Effect — PASS

- **Input:** Posted invoice 556 and refund 557; no separate manual credit deduction.
- **Expected business result:** Invoice Sales +₹64,500 and COGS +₹61,938.69; refund Sales -₹64,500 and COGS -₹64,770. Pair nets Sales ₹0, COGS -₹2,831.31, GM +₹2,831.31.
- **Actual system result:** Controlled accounting report; wage ₹20,000; Sales ₹0; COGS -₹2,831.31; GM/adjusted GM/Actual Base ₹2,831.31; transport/loading/expenses/commission ₹0; Flat threshold/required ₹120,000; carry disabled; eligible base/rate/main/bonuses/adjustments/final ₹0; notice No.
- **Explanation:** Signed Sales and COGS balances are included exactly once. There is no second generic credit-note deduction.
- **Sources:** `account.move(556)` `SL/FY25-26/054`; `account.move(557)` `RMHD/25-26/0002`; Sales account `50103000`; COGS account `60101000`.
- **Data issue:** Refund COGS reversal exceeds its Sales reversal, producing a positive ₹270 refund GM effect. Finance confirmation is required if this posting is unintended.

## N. Real New-Customer Incentive — PASS

- **Input:** Live June 2026 company history; strict billing >₹100,000; GM ≥3.5%; count 3; bonus ₹2,000/customer; event-date owner.
- **Expected business result:** Three qualifying events owned by Aditya pay ₹6,000.
- **Actual system result:** Standard/schema 1.0; wage ₹20,000; Sales ₹10,999,360.50; COGS ₹10,381,572.14; GM/adjusted GM ₹617,788.36; transport/loading ₹0; expenses ₹6,233.79; commission ₹0; Actual Base ₹611,554.57; Flat threshold/required ₹120,000; carry ₹0; eligible ₹611,554.57; rate 10%; main ₹61,155.46; new bonus ₹6,000; repeat bonus ₹4,000; adjustments ₹0; final ₹71,155.46; notice No.
- **Explanation:** Global event values are derived from complete customer accounting history. Paid events: `new:13302:7127` billing ₹229,861/GM ₹13,350.28/GM 5.808%; `new:13291:7265` ₹349,920/₹42,768/12.2222%; `new:13320:7274` ₹586,710/₹61,992/10.566%. Each is owned by `hr.employee(4)`.
- **Sources:** `account.move(7127,7265,7274)`; `res.partner(13302,13291,13320)`; customer owner from `res.partner.user_id` at event date.

## N-COUNT. Employee-Level Minimum After Global Qualification — PASS

All events use globally evaluated customer history, billing ₹200,000, GM ₹20,000, resolved event-date owners, employee minimum 3, and bonus ₹2,000 per customer.

| Scenario | Input owner split | Expected bonuses | Actual bonuses | Result |
| --- | ---: | ---: | ---: | --- |
| N-COUNT-2-1 | 2 / 1 | ₹0 / ₹0 | ₹0 / ₹0 | PASS |
| N-COUNT-3-1 | 3 / 1 | ₹6,000 / ₹0 | ₹6,000 / ₹0 | PASS |
| N-COUNT-3-3 | 3 / 3 | ₹6,000 / ₹6,000 | ₹6,000 / ₹6,000 | PASS |
| N-COUNT-4-2 | 4 / 2 | ₹8,000 / ₹0 | ₹8,000 / ₹0 | PASS |

- **Explanation:** Company-wide history determines whether each customer qualifies. Qualifying events are then attributed to owners and grouped by employee. Each employee must independently own at least three qualifying customers before any of that employee's new-customer bonuses are paid.
- **Sources:** Controlled normalized `N-COUNT-*` events; two resolved owners per scenario; no Odoo mutation.

## O. Real Repeat-Customer Incentive — PASS

- **Input:** Live June 2026 global history; 90-day window; qualified-new requirement; event-date repeat owner; ₹2,000 bonus; maximum one payout per customer.
- **Expected business result:** Two qualifying repeats owned by Aditya pay ₹4,000. Later repeats for the same customer do not pay again.
- **Actual system result:** Same June accounting/main result as N; repeat bonus ₹4,000; new bonus ₹6,000; final ₹71,155.46; notice No.
- **Explanation:** `repeat:13320:7343` occurs one day after `new:13320:7274`, billing ₹400,680, GM ₹42,336 (10.566%), owner employee 4. `repeat:13327:7341` occurs three days after `new:13327:7207`, billing ₹343,440, GM ₹36,288 (10.566%), repeat owner employee 4. Customer 13327 has later July repeats, but none pay after the first because maximum payout is one.
- **Sources:** Moves `7343,7341`; partners `13320,13327`; global first events `7274,7207`; later customer 13327 repeat moves `7668,7669,7901,7903,7920,8118,8119` confirm limit consumption.

## O-RULES. Repeat Window and GM Conditions — PASS

- **Input:** Controlled repeat minimum billing ₹50,000; GM amount ₹5,000; GM 10%; 90-day window; low-GM, day-90, and day-91 events.
- **Expected business result:** Low-GM and day-91 events fail; day-90 event pays ₹2,000.
- **Actual system result:** Aditya; 2098-04; UAT Repeat Window and GM/schema 1.0; wage ₹20,000; accounting/Actual Base ₹0; Flat threshold/required ₹120,000; carry out ₹120,000; main/new ₹0; repeat ₹2,000; adjustments ₹0; final ₹2,000; notice No.
- **Explanation:** GM ₹4,999 fails the amount rule. The boundary event on day 90 passes all conditions. Day 91 is outside `repeatWindowDays = 90`.
- **Sources:** Controlled events `uat-repeat-new`, `uat-repeat-low-gm`, `uat-repeat-day-90`, `uat-repeat-day-91`; no Odoo mutation.

## P. Adjustment — PASS

- **Input:** Approved calculation 2 for Ankita, February 2099; raw incentive ₹0; +₹1,000 and -₹250 adjustments.
- **Expected business result:** Adjustment total ₹750 and final ₹750 without overwriting raw incentive.
- **Actual system result:** Active locked Standard-equivalent version 1; wage ₹20,000; Sales/COGS/GM/adjusted GM/deductions/Actual Base ₹0; Flat threshold/required ₹120,000; carry in ₹0/out ₹120,000; eligible/rate/main/new/repeat ₹0; adjustments ₹750; final ₹750; notice No.
- **Explanation:** `₹0 raw + ₹1,000 - ₹250 = ₹750 final`; approved snapshot retains raw and adjustment fields separately.
- **Sources:** `x_sunlectric_incentive_calculation(2)`; adjustments `x_sunlectric_incentive_adjustment(2)` add ₹1,000 and `(3)` deduct ₹250.

## Q. Notice Streak — PASS

- **Input:** Four consecutive zero-Actual-Base months under Standard rules; performance notice threshold four failed months.
- **Expected business result:** No notice during months 1-3; notice in month 4.
- **Actual system result:** Aditya; 2098-04; wage ₹20,000; all accounting fields/Actual Base ₹0; Flat normal threshold ₹120,000; carry in ₹360,000/out ₹480,000; required threshold ₹480,000; carry consumed/eligible/rate/main/bonuses/adjustments/final ₹0; notice **Yes**.
- **Explanation:** Failure streak increments each unrecognized month and reaches four in April. Carry grows by ₹120,000 per zero-base month.
- **Sources:** Controlled normalized four-month UAT input; no Odoo mutation.

## Customer Validation Summary

- **Global history:** Customer events are derived from all posted invoice/refund history through the calculation period.
- **Billing and GM:** Real N events exceed strict ₹100,000 billing and 3.5% GM thresholds.
- **Ownership:** Each paid event uses its own event-date owner. Missing owner remains pending.
- **Repeat window/GM:** O-RULES confirms day 90 inclusive, day 91 excluded, and configurable billing/GM checks.
- **Payout limit:** Customer 13327's first repeat pays; seven later repeats do not pay under maximum one.
- **Employee count gate:** The global total does not unlock payouts. `minimumQualifyingCustomers` is evaluated per employee after global qualification and event-date ownership attribution.

## Accounting Validation Summary

| Source | Signed effect | Actual Base treatment | Result |
| --- | --- | --- | --- |
| Invoice 556 | Sales +₹64,500; COGS +₹61,938.69 | GM +₹2,561.31 | PASS |
| Credit note 557 | Sales -₹64,500; COGS -₹64,770 | GM +₹270 from posted entries | PASS, data review |
| Employee expenses | Eleven posted lines total ₹4,242 | Deducted once from employee 4 | PASS |
| Commission line 9100 | Account 211810 debit ₹49,926 | Deducted once only after attribution | PASS |

## Mismatches and Classifications

### Implementation Bug

None found in this clarification pass.

### Corrected UAT Interpretation

1. **Root cause:** The previous `N-GLOBAL` expected result conflated global customer qualification with employee payout eligibility. The engine already implemented the clarified flow correctly; the obsolete expected ₹2,000 bonus for an employee owning only one of three globally qualifying customers was wrong.

### Data Issue

1. **Credit note 557:** COGS reversal ₹64,770 exceeds Sales reversal ₹64,500, causing positive refund GM ₹270. The engine correctly follows posted signed entries once; Finance should validate the posting.

### Business-Rule Ambiguities Requiring Management Confirmation

1. **Negative previous base:** With previous unpaid base enabled, a -₹70,000 Actual Base is also stored as -₹70,000 accumulated unpaid base, which can reduce a later accumulated payout. Confirm whether only carry should increase or whether negative unpaid base should also roll forward.
2. **Repeat after unresolved original owner:** Customer 13327's original new event owner is pending, while its repeat-event owner is resolved to employee 4. Current rules pay the repeat owner because qualification is global and repeat ownership is independently resolved. Confirm this remains intended.

### Expected Differences From Legacy Python

1. New-customer billing is strict `> ₹100,000`; the legacy Python used `>=`.
2. Credit notes use posted signed Sales and COGS effects exactly once rather than an additional generic final-base deduction.
3. Missing employee/owner attribution remains unresolved instead of being guessed.

## Implementation Changes During UAT

No calculation formula or business behavior changed. The existing per-employee grouping was extracted into an explicitly named engine helper, four cross-owner regression tests were added, the preset schema/UI/documentation were clarified, and the obsolete UAT expectation was replaced.

## Reproduction

Run `npm run phase6:uat`. The script reads server-side Odoo configuration, performs no writes, executes the current pure TypeScript engine, compares expected fields, and outputs machine-readable JSON.
