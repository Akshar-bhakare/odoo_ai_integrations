# Phase 5 Live End-to-End Verification

Verification date: 2026-08-21. Environment: neutralized Odoo Online 19 test database, company `SUNLECTRIC PRIVATE LIMITED` (`res.company(1)`). Odoo credentials remained server-side in the existing environment configuration. No password or API key was written to source code, returned to the browser, or included in this report.

## 1. Login and Identity

- Odoo's interactive `/web/session/authenticate` endpoint rejected the server API key as a user password with HTTP 401. A true credential login could not be completed without a usable Odoo password, and no password was requested from or added by the user.
- A server-only, ten-minute verification session was signed with the existing `SESSION_SECRET` for the API-key owner. This exercised the production session verifier, Odoo identity lookup, company mapping, employee mapping, role mapping, protected APIs, CSRF validation, and logout without exposing credentials to client code.
- Verified actor: `res.users(2)` ANKITA GAUR, company 1, mapped to `hr.employee(1)`, role `administrator`.
- Protected reads returned 200 for presets, assignments, calculations, unresolved commissions, unresolved customer owners, and Orders. Logout returned 200.
- This confirms the application session-to-Odoo mapping path, but it is not a substitute for a real password-based browser login.

## 2. Roles and Permissions

Live groups exist with IDs 161 through 165 for Employee, Reviewer, Approver, Administrator, and Payment Recorder. Only Administrator currently has a live member (`res.users(2)`); the other four groups have no users, so real-user browser verification for those roles is blocked by missing Odoo fixtures.

Server authorization and UI capabilities are covered by automated tests for:

- Employee own-record reads and rejection of cross-employee reads/writes.
- Reviewer review/attribution access without approval, payment, or administration access.
- Approver approval access.
- Payment Recorder payment access without approval or administration access.
- Administrator company-scoped configuration access.
- Cross-company rejection for reads and writes.

Anonymous calls to `/api/auth/session`, `/api/incentives/calculations`, and `/api/odoo/orders` returned 401. A signed session without the CSRF header received 403 for a write.

## 3. Real Employee Flat Calculation

Test employee: `hr.employee(4)` Aditya Ashok Munde. `hr.employee.wage = INR 20,000`; salary version `hr.version(4)` is effective 2025-11-23. December 2025 therefore uses INR 20,000 on the first day of the month.

| Value | Amount |
| --- | ---: |
| Net Sales | INR 15,978,462.50 |
| COGS | INR 14,331,121.35 |
| Gross Margin | INR 1,647,341.15 |
| Employee expenses | INR 4,242.00 |
| Commission | INR 0.00 |
| Actual Base | INR 1,643,099.15 |
| Flat threshold (6 x salary) | INR 120,000.00 |
| Eligible base | INR 1,643,099.15 |
| Rate | 10% |
| Main incentive | INR 164,309.92 |

The threshold is met, carry-in/out are zero, entire eligible base is paid, and the pure engine result and dashboard view model show the same salary, base, threshold, eligibility, and incentive values.

## 4. Expenses

- The real assigned employee expense of INR 4,242 is included once and deducted from Aditya's Actual Base.
- A temporary incentive-only unresolved marker was created for posted bill `account.move(1641)` (`BILL/25-26/12/0001`) using one INR 10,000 expense line. Accounting ownership was not changed.
- Before assignment, the source appeared as unresolved. The protected attribution API assigned it to exactly one employee. Aditya's normalized December employee expenses changed from INR 4,242 to INR 14,242, and the unresolved source disappeared.
- The temporary attribution row was removed in `finally`; no split or accounting mutation occurred.

## 5. Commissions

Six posted account `211810 Sales Commission Expense` lines are currently unattributed and remain unresolved: INR 21,000, 12,000, 7,000, 22,200, 49,926, and 15,000 (INR 127,126 total).

For controlled verification, line `account.move.line(9100)` from `BILL/25-26/01/0021` was temporarily assigned to Aditya through the protected API. January commission changed from INR 0 to INR 49,926 and therefore reduces Actual Base by INR 49,926. The assignment was removed afterward. Without assignment, the line remains unresolved and is never guessed.

## 6. Credit Note

Representative posted pair:

| Move | Sales | COGS | Gross Margin effect |
| --- | ---: | ---: | ---: |
| Invoice `SL/FY25-26/054` (`account.move(556)`) | +INR 64,500.00 | +INR 61,938.69 | +INR 2,561.31 |
| Refund `RMHD/25-26/0002` (`account.move(557)`) | -INR 64,500.00 | -INR 64,770.00 | +INR 270.00 |

The refund debits sales account `50103000` by INR 64,500 and credits COGS account `60101000` by INR 64,770. Normalization applies the signed sales and COGS entries exactly once; there is no second manual credit-note deduction.

The refund's posted COGS reversal exceeds its sales reversal, so its accounting-derived Gross Margin effect is positive INR 270 rather than a negative reversal. That is an Odoo accounting-data result, not an engine adjustment, and should be reviewed by Finance if unintended.

## 7. Customer Incentives

Aditya's June 2026 real data produces:

- Three globally qualifying new-customer events, all resolved to employee 4: billing INR 229,861 / GM INR 13,350.28; billing INR 349,920 / GM INR 42,768; billing INR 586,710 / GM INR 61,992.
- New-customer bonus: 3 x INR 2,000 = INR 6,000.
- Two qualifying repeat events resolved to employee 4: billing INR 343,440 / GM INR 36,288 and billing INR 400,680 / GM INR 42,336.
- Repeat bonus: 2 x INR 2,000 = INR 4,000.

The engine also preserves pending ownership rather than guessing. The corrected August 2026 unresolved-owner workbench returns 21 month-specific events instead of 999 historical events. The December calculation fixture has 40 relevant unresolved qualifying owner events, which correctly block approval for that month.

## 8. Presets

- Live persistence contains one retained Phase 2 QA preset with an active locked version 1 and draft version 2. Active version 1 is configuration-equivalent to the Standard Sales Incentive: 6x salary, carry enabled, 10%, entire eligible base, and previous unpaid base included.
- The persisted preset is still QA-named rather than a production-named `Standard Sales Incentive` record.
- Existing live smoke verification covers draft creation/update, activation/locking, versioning instead of mutation, JSON/schema checks, and direct locked-version mutation rejection.
- The preset form conditionally renders Flat-only controls under Flat and Slab threshold/slab controls under Slab. Fixed-amount and salary-multiple slabs, carry on/off, Flat payout basis, and Flat previous-base configuration are represented by the approved schema and engine tests. Slab does not render Flat threshold, above-threshold, or previous-base controls.
- A second disposable live preset was not created because the retained QA preset/version chain already covers persistence and avoids additional live clutter. Full visual interaction remains part of the browser-login blocker.

## 9. Assignment

Retained Phase 5 QA assignment `x_sunlectric_incentive_assignment(2)` maps employee 1 to active locked Standard-equivalent version 1 for 2099-02-01 through 2099-02-28. The authoritative service resolved exactly one effective version. An overlapping assignment was rejected. The future period avoids operational collision and preserves an auditable historical fixture.

## 10. Adjustments

Calculation `x_sunlectric_incentive_calculation(2)` has raw incentive INR 0, a +INR 1,000 adjustment, and a -INR 250 adjustment:

`INR 0 + INR 1,000 - INR 250 = INR 750 final incentive`

Raw incentive was not overwritten; adjustment total is stored separately as INR 750.

## 11. Review, Approval, and Snapshots

- The protected workflow created the draft through the authoritative API, recalculated from a fresh Odoo extraction, submitted it, and approved it through the same pure TypeScript engine.
- Draft unresolved-source count was zero for the future QA month.
- Approved rules, input, result, threshold, carry, and checksum snapshots were retained.
- Post-approval adjustment was rejected. Direct Odoo mutation of final incentive was rejected by the global immutability rule.
- A Phase 5 defect was fixed: historical or nonqualifying customer-owner issues no longer block an unrelated month's approval. Monthly accounting gaps remain blocking.

## 12. Payment

Payment `x_sunlectric_incentive_payment(2)` records INR 750 against approved calculation 2. Overpayment was rejected.

Live verification exposed that Odoo's approved-calculation immutability rule correctly rejects writes to cached `x_paid_amount` and `x_payment_state`. Payment handling was corrected so payment rows are the source of truth and read APIs derive paid amount/state. The approved calculation remains unchanged (`0 / unpaid` in its legacy cache fields), while the API returns `INR 750 / paid`. Input checksum, result snapshot, and carry state are therefore unaffected by payment.

## 13. Payment Mode

No dedicated payment-mode field was added. The existing V1 notes behavior remains unchanged, per the clarified business requirement. No further payment-mode implementation is recommended for V1.

## 14. Browser and Security Smoke

- Production build pages `/login`, `/incentives`, `/incentives/presets`, `/incentives/assignments`, and `/odoo/orders` respond successfully.
- Signed-session protected reads and Orders returned 200; anonymous APIs returned 401; missing CSRF returned 403; logout returned 200.
- Odoo Online rate-limited an earlier burst of parallel verification requests with HTTP 429. The verification script now performs protected reads sequentially with a delay; the final smoke completed without rate-limit errors.
- A real authenticated browser walkthrough is still blocked because an interactive Odoo password is unavailable and non-administrator role groups have no test users. Credentials remain server-side and are never requested by client code.

## 15. Remaining Production Blockers

1. Provide or establish a normal interactive login method for at least one test Odoo user without putting credentials in source code. The current API key is valid for server JSON-2 calls but not interactive session authentication.
2. Assign real test users to Employee, Reviewer, Approver, and Payment Recorder groups, with valid company and employee mappings, for live per-role browser tests.
3. Resolve operational data gaps before approving affected months: six unattributed commission lines; 77 invoice-salesperson-to-employee mapping gaps and 999 historical customer-owner gaps in the inspected 2025-08 through 2026-08 dataset. The workbench and approval now scope these correctly by month/relevance.
4. Create/rename a production Standard Sales Incentive preset instead of relying on the retained QA-named preset.
5. Finance should review refund 557's COGS reversal if the positive INR 270 Gross Margin effect is not intended.

## 16. Validation

- Vitest: 17 files, 87 tests passed.
- ESLint: passed.
- TypeScript `tsc --noEmit`: passed.
- Next.js production build: passed; 26 pages/routes generated and all Incentives, authentication, and Orders routes compiled.

## Files Changed

- `scripts/phase5-live-verification.ts`
- `package.json`
- `src/lib/incentives/odoo/contracts.ts`
- `src/lib/incentives/odoo/normalization.ts`
- `src/lib/incentives/odoo/normalization.test.ts`
- `src/lib/incentives/odoo/service.ts`
- `src/lib/incentives/odoo/service.test.ts`
- `src/lib/incentives/odoo/studio-repository.ts`
- `src/lib/incentives/api/service.ts`
- `src/lib/incentives/api/payment.ts`
- `src/lib/incentives/api/service.test.ts`
- `docs/incentives/PHASE4_UI.md`
- `docs/incentives/PHASE5_LIVE_VERIFICATION.md`
