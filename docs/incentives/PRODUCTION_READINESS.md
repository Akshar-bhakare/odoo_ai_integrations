# Sunlectric Incentive Production Readiness

Audit date: 2026-08-22  
Environment: neutralized Odoo Online 19 test database, `SUNLECTRIC PRIVATE LIMITED` (`res.company(1)`)  
Representative month: July 2026  
Audit mode: read-only; no Odoo data or incentive business rule was changed

## Overall Decision

**NOT READY for real incentive approval or payment.**

The calculation and accounting implementation is UAT-approved and deterministic, but production use remains blocked by two unresolved business decisions, missing production assignments and role membership, substantial unresolved Odoo attribution data, incomplete revision/payment safety, and unverified multi-company isolation. The system may proceed only to read-only parallel calculation after the rollout prerequisites below are satisfied.

## A. Ready

### Business Rules

| Area | Verified implementation |
| --- | --- |
| Flat | Configurable salary multiplier, carry on/off, fixed rate, entire-base/above-threshold payout, previous-base/current-month payout, signed negative Actual Base |
| Slab | No Flat threshold, fixed/salary-multiple thresholds, highest matching slab, whole recognized base, carry on/off, no progressive slabs, no prior-base accumulation, no above-threshold mode |
| New customer | Company-global history and customer qualification, event-date customer owner, employee-level monthly minimum count, configurable billing/GM/bonus, independent enablement |
| Repeat | Company-global history, event-date repeat owner, configurable window/billing/GM/bonus/payout limit, independent enablement |
| Accounting | Posted-only invoices, refunds, COGS, transport/loading, employee expenses, commissions, and signed credit-note effects counted once |
| Salary | `hr.employee.wage`/`hr.version.wage`; version effective on the first calendar day; no V1 proration |

The pure engine remains free of Odoo dependencies. Schema and domain validation fail closed for invalid presets and input state. The initial Standard rehearsal preset remains Flat, 6x salary, carry enabled, 10%, entire eligible base, and previous unpaid base included.

### Odoo and Persistence

- Live Studio schema inspection reports `ready: true`, with no missing models, fields, or field mismatches.
- One active locked preset version passes JSON schema and SHA-256 checksum verification; draft version 2 is unlocked as expected.
- Posted-state filters are present in both move and journal-line extraction.
- Current approved snapshots have valid rules and input checksums, engine version, salary source, input/result snapshots, and source-audit support.
- Locked preset versions and approved calculations, adjustments, and source audits have live Odoo record rules preventing subsequent mutation.
- The application never accepts a client-supplied final incentive. Draft/recalculation/approval values come from the server-side pure TypeScript engine.
- Approval reloads the persisted employee/month identity, effective assignment, active locked preset, current accounting data, attributions, adjustments, and prior approved state before recalculation.
- Sequential duplicate approval is rejected because only `review` calculations can transition to `approved`.
- Employee/company identity checks prevent request parameters from changing the persisted calculation employee during recalculation or approval.
- Mandatory unresolved sources block approval; attribution is never guessed.

### Authentication Controls

- Sessions are signed, HTTP-only, same-site, eight-hour JWT cookies containing only user identity and CSRF state.
- Every protected request reloads the active Odoo user, current/allowed companies, role groups, and employee mapping.
- Write routes require same-origin and CSRF verification.
- Role authorization is enforced again inside persistence methods, not only in the UI.
- Automated authorization tests cover unauthenticated access, employee self-scope, company scope, reviewer/approver/admin actions, and payment-recorder scope.

### Deterministic Replay

July was replayed from gap-free history using the Standard rehearsal configuration because no production assignment exists. Each engine run was repeated with identical normalized inputs.

| Employee | Salary | Sales | COGS | GM | Expenses | Actual Base | Carry In/Out | New | Repeat | Final | Deterministic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Aditya Ashok Munde (4) | ₹20,000 | ₹14,808,038.75 | ₹13,936,526.49 | ₹871,512.26 | ₹1,930.61 | ₹869,581.65 | ₹0 / ₹0 | ₹12,000 | ₹8,000 | ₹106,958.17 | PASS |
| Puja Madawar (5) | ₹20,000 | ₹16,775,157.00 | ₹15,672,663.04 | ₹1,102,493.96 | ₹0 | ₹1,102,493.96 | ₹0 / ₹0 | ₹12,000 | ₹10,000 | ₹132,249.40 | PASS |
| Shoaib Ahmed (6) | ₹20,000 | ₹12,546,621.70 | ₹11,785,958.87 | ₹760,662.83 | ₹8,903.82 | ₹751,759.01 | ₹0 / ₹0 | ₹0 | ₹0 | ₹75,175.90 | PASS |

Transport, loading, commission, and adjustments are zero for these July employee rows. The repeated result checksums matched exactly:

- Employee 4: `482d9aed89d69376512c4f2a8f65d1aec523bc53738e5b2db4206a842ebd695b`
- Employee 5: `2a245abd8a9f0e31f8f98207960fdc2a6c410ced3a0ddd7cccd8101aa80783b2`
- Employee 6: `be74c8a7044ca94884145907cc3d79d461e77b8f8827645e4d8713f5790951e8`

These are rehearsal values, not approvable production results. Each employee's July preparation still contains 19 unresolved salesperson mappings and 25 unresolved qualifying customer-owner events.

## B. Blocked

### Critical Blockers

1. **Negative unpaid-base business decision is not conclusively approved.** Current code and the design formula implement option 1: `UnpaidBaseOut = prior unpaid base + signed Actual Base`; therefore ₹50,000 plus -₹20,000 becomes ₹30,000. The later UAT report explicitly asks management to confirm this behavior. The conflicting documentation must be resolved before production.
2. **Repeat after unresolved original owner is not conclusively approved.** Current behavior allows a globally qualified new customer with unresolved original ownership to produce a repeat payout when the repeat event has a resolved event-date owner. Management must confirm whether to keep this behavior or block the repeat.
3. **No production employee has an effective preset assignment.** All nine active wage employees have zero July assignments. The only active assignment is a Phase 2 QA record for employee 1 in February 2099, so authoritative production draft creation fails closed.
4. **July source data blocks approval.** July has 19 posted customer moves whose salesperson does not map to an active employee and 124 customer events with unresolved historical ownership. Twenty-five unresolved qualifying owner events are approval-relevant under the Standard rehearsal configuration.
5. **Revision completion is incomplete.** A new revision stores `x_supersedes_id`, but approving it never changes the prior approved record to `superseded`. Two approved records for one employee/month could remain simultaneously payable.
6. **Duplicate payment prevention is incomplete.** Payment recording prevents sequential overpayment but has no idempotency key or uniqueness check for calculation/reference. Concurrent requests can both pass the pre-read and create duplicate/over-limit payments.
7. **Multi-company isolation is not complete at Odoo record-rule level.** All custom models have required `x_company_id` fields and application queries filter the actor's current company, but live Studio has no explicit allowed-company record rules for reviewer, approver, administrator, payment-recorder, or shared preset reads. Only company 1 is available to the current API user, so cross-company denial could not be live-tested.
8. **Production role users are not configured or live-tested.** Only user 2 belongs to the Incentive Administrator group. Employee, Reviewer, Approver, and Payment Recorder groups are empty.

### Non-Critical Blockers

1. Actual Odoo credential login could not be completed with the server API key because an API key is not the user's Odoo web password. A server-signed test session verified the current administrator identity, protected reads, CSRF path, and logout, but real Employee/Reviewer/Approver/Payment Recorder logins remain untested.
2. The retained QA preset and records are production-looking but QA-named. They must be clearly archived/excluded or replaced with approved production configuration.
3. Approved QA calculation 1 has no reviewer identity or review timestamp because it predates the final workflow. Its checksums and approval metadata are valid, but it does not satisfy the final audit chain.
4. Numeric legacy parity cannot be completed from the supplied files alone. The legacy program also requires external salary, commission, credit-note, and optional transport/loading files, and no captured legacy output was supplied.
5. The current Web Worker maps persisted dashboard records into view rows; it does not execute the incentive engine. This is not a correctness issue, but the intended client-side calculation offload is not present. Authoritative calculation correctly remains server-side.

## C. Management Decisions Required

### 1. Negative Unpaid-Base Accumulation

Current behavior:

```text
Previous unpaid base = ₹50,000
Current Actual Base  = -₹20,000
Unpaid base out      = ₹30,000
Carry increases independently by the signed-base shortfall
```

Management must explicitly approve this option or define another behavior. No implementation change should occur until that decision is recorded.

### 2. Repeat When Original Owner Is Unresolved

Current behavior uses global new-customer qualification and independently resolves the repeat event's owner. A qualifying repeat can therefore pay its event-date owner even when the original new-customer owner remains unresolved. Management must choose whether this remains allowed or whether the original owner gap blocks repeat payout.

### 3. Standalone Accounting Adjustments

Confirm whether any specifically identified discount, bad-debt, pricing-correction, or miscellaneous journal accounts should enter `signedAccountingAdjustments`. V1 currently excludes them unless explicitly configured, preventing guessed classification and double counting.

The same-day ownership rule is not open: ownership is evaluated at the start of the local calendar day. Historical gaps remain pending and are never guessed.

## D. Data Cleanup Required

### Employees and Salary

- Nine active employees have positive wages; none has a missing current wage.
- Tarun Khadatkar (`hr.employee(3)`) has no `res.users` mapping.
- Every active wage employee has at least one salary-history version and no duplicate effective-date conflict.
- ANAM BANO (8) and HARESHA ABHAY THAKKUR (9) have no salary version effective for July; confirm they were not in the July population. Their later salary versions exist.

### Customers and Ownership

- 263 commercial customers were observed through July.
- 171 currently have no customer owner.
- 10 current owners do not map to an active employee.
- 978 historical customer events have unresolved event-date ownership through July.
- July alone contains 124 unresolved owner events; 25 are relevant qualifying events under the rehearsal preset.
- Twenty-six events share a date with an owner change. The start-of-day algorithm was applied consistently; 24 remain pending because the start-of-day owner cannot be resolved.

### Accounting Attribution

- Six posted account `211810` lines remain unassigned: journal lines `2039`, `2080`, `2082`, `2085`, `9100`, and `11086`.
- No unresolved commission line occurs in July, but historical calculations covering their months cannot be approved until assignment.
- No unresolved employee-expense source or expense assignment conflict was found in the audited period.
- July has 19 posted customer moves with missing invoice-salesperson employee mapping. These must be corrected or explicitly resolved through an approved policy before July approval.

### Assignments and Presets

- Create approved production assignments with exactly one effective preset version per included employee/month.
- Replace or rename the retained `[PHASE2 QA ...]` preset only through a new validated version/preset; do not mutate the active locked version.
- Define the production start month and employee population before assignment creation.
- Archive or clearly label the February 2099 QA assignment and 2099 QA calculations so they cannot be mistaken for production.

### Roles

- Assign separate named users to Employee, Reviewer, Approver, and Payment Recorder groups.
- Verify each user's allowed company list and employee mapping.
- Prefer separate reviewer and approver users for operational segregation, even though Administrator can currently perform both actions.

## E. Security

### Confirmed

- Authentication secrets and Odoo credentials remain server-side; no API key is sent to browser code.
- App APIs enforce signed session, active Odoo identity revalidation, company membership, role checks, CSRF on writes, and employee self-scope.
- Client request bodies cannot supply calculation results, snapshots, checksums, company IDs, approval identities, or final incentive values.
- Recalculation and approval bind fresh inputs to the persisted employee, company, month, and preset version.
- Odoo Studio schema has 29 active Incentive ACL records and nine active record rules.
- Employee Odoo record rules restrict own assignments, calculations, sources, and payments.
- Approved/locked immutability rules are live.

### Not Yet Safe for Production

- Add and live-test allowed-company record rules for every company-scoped Incentive model and role before any multi-company deployment.
- Add concurrency-safe revision supersession and payment idempotency/uniqueness before enabling approval/payment.
- Live-test all five roles using real user sessions; do not rely only on administrator or synthetic test sessions.
- The in-memory login rate limiter is per application process and trusts proxy client-address headers. Production deployment must enforce trusted-proxy handling and an external edge/WAF rate limit if horizontally scaled.

## F. Performance

The July audit loaded 1,328 moves, 8,653 lines, and 1,159 customer events. Extraction plus normalization took approximately 7.6 seconds. Pure engine runs took approximately 22-31 milliseconds per employee, confirming that Odoo extraction—not calculation—is the dominant cost.

Clear production concerns:

1. Every authoritative calculation refetches company-wide customer history through the period end.
2. Partner ownership tracking is fetched broadly before messages are narrowed to relevant partners.
3. Multiple employees calculated for the same month repeat nearly identical Odoo extraction and normalization.
4. Every calculation input snapshot contains global customer history. Existing approved calculation 2 stores a 279,216-byte input snapshot for a single month.
5. Calculation-source persistence includes every normalized customer event in the input, not only paid/relevant events, increasing Odoo record volume.
6. The dashboard worker only transforms rows; it does not reduce server extraction or engine work.
7. Odoo pagination is implemented with 500-record pages, so large datasets are complete rather than truncated.

Do not optimize the formulas. Before broad rollout, measure a full month for the complete employee population and introduce bounded reuse of one immutable company/month extraction bundle per request batch or job. Preserve approval-time freshness and checksums.

## G. Migration and Rollout

### Stage 0: Blocker Closure

- Record the two management decisions.
- Create production preset/version and non-overlapping assignments.
- Resolve July/source-period salesperson, customer-owner, commission, and employee mapping gaps.
- Configure and test real role users and company restrictions.
- Correct revision supersession and payment idempotency/concurrency safety.
- Complete a representative legacy comparison using captured legacy outputs and all legacy side files.

### Stage 1: Read-Only Parallel Calculation

- Run the new system without creating approvable records.
- Start with three employees and one closed month.
- Freeze source cut-off time and retain input/result checksums.
- Keep the XLSX/Python process authoritative.

### Stage 2: Compare With Manual/Python Workflow

- Compare employee/month totals and each accounting/customer component.
- Classify differences as expected design difference, legacy bug, data difference, new implementation bug, or unresolved rule.
- Expected design differences already identified include strict `> ₹100,000`, customer-owner attribution, configurable per-employee count, Odoo salary history, signed credit-note treatment, and finalized bonus/configuration values.

### Stage 3: Management Review

- Management signs off each classified difference and the two open decisions.
- Finance signs off credit-note postings and accounting-source scope.
- HR signs off salary versions and employee population.

### Stage 4: Draft Calculations

- Enable production draft creation for the pilot only.
- Reviewer checks source records, unresolved queues, carry checkpoint, and adjustments.
- Continue manual calculations in parallel.

### Stage 5: Approval

- Enable approval only after two consecutive closed months match approved expectations.
- Use separate reviewer and approver accounts.
- Retain the manual workflow as a verification control for the first approved cycle.

### Stage 6: Payment Recording

- Enable only after payment idempotency and concurrency tests pass.
- Reconcile recorded payment references and totals against Finance records.
- Expand employee coverage gradually after a successful pilot.

## H. Rollback

If results are unexpected:

1. Disable creation/approval/payment permissions for production role groups; do not delete snapshots.
2. Keep approved snapshots and source audits immutable for investigation.
3. Stop at the last completed rollout stage and return the manual XLSX/Python workflow to authoritative status.
4. Export the affected calculation input, result, checksums, and source records.
5. Reproduce with the recorded engine version and immutable preset rules.
6. Classify the difference before changing code or data.
7. Correct source data through normal Odoo accounting/HR processes or audited incentive attribution records; never rewrite approved snapshots.
8. If correction is required, create a revision linked to the original after revision supersession is fixed and validated.

## Approval Safety Matrix

| Control | Status | Evidence / gap |
| --- | --- | --- |
| Unauthorized client approval blocked | PASS in code/tests | Approver or Administrator required server-side |
| Client cannot alter final incentive | PASS | Result fields are never accepted from request body |
| Client cannot switch persisted employee | PASS | Fresh input identity checked against calculation |
| Mandatory unresolved attribution blocks | PASS | Service and engine reject unresolved approval |
| Server recalculates before approval | PASS | Fresh extraction and pure engine execution |
| Approved snapshot immutable | PASS | Live global write/unlink record rules |
| Sequential duplicate approval blocked | PASS | State must be `review` |
| Revision supersedes prior approval | **FAIL** | Link is stored, prior state is not changed |
| Sequential overpayment blocked | PASS | Existing recorded sum checked |
| Duplicate/concurrent payment blocked | **FAIL** | No idempotency/unique key; read-then-create race |

## Auditability Matrix

| Question | Source | Status |
| --- | --- | --- |
| Employee, company, month | Calculation identity fields | PASS |
| Preset and version | Version relation + rules snapshot/checksum | PASS |
| Salary and source | Salary amount + `x_salary_source_key` + input snapshot | PASS |
| Accounting/expenses/commission | Calculation source records + input snapshot | PASS |
| Customer incentives | Customer event snapshots + result IDs | PASS |
| Adjustments | Immutable adjustment records and result total | PASS |
| Reviewer/approver and timestamps | Calculation workflow fields | PASS for final workflow; QA calculation 1 incomplete |
| Engine version | `x_engine_version` | PASS |
| Rules/input checksum | SHA-256 fields verified against snapshots | PASS |
| Payments | Payment records with recorder/time/reference | PASS, duplicate safety blocked |

## Legacy Parity

The supplied legacy Python and journal-item XLSX were inspected. A trustworthy numeric parity run is blocked because no legacy output was supplied and the application depends on external files outside the repository:

- `SALESPERSON SALARIES.xlsx`
- `COMMISSIONS.xlsx`
- `CREDIT_NOTES.xlsx`
- optional invoice transport/loading charges file

Static comparison confirms intentional differences:

| Difference | Classification |
| --- | --- |
| Legacy billing uses `>= ₹100,000`; final V1 uses strict `>` | Expected design difference |
| Legacy minimum count is 1 and bonuses are ₹1,500 constants; final preset uses configurable values (Standard 3 and ₹2,000) | Expected design difference |
| Legacy attributes customer incentives through invoice salesperson; final V1 uses event-date customer owner | Expected design difference |
| Legacy Flat payout uses current base only; final engine can include previous unpaid base | Expected design difference |
| Legacy salary/commission/credit notes depend on side files; final system uses authoritative Odoo sources and audited assignments | Expected design difference/data difference |
| Legacy credit notes use a separate local assignment database; final system uses posted signed Sales/COGS once | Expected design difference |
| Legacy implements only one Flat scheme; final engine supports approved Flat and non-progressive Slab configuration | Expected design difference |

No new-engine implementation bug was identified from static legacy comparison. Numeric Stage 2 parity remains a rollout gate, not a reason to change finalized rules.

## Reproduction

Run:

```text
npm run phase7:audit
npm run phase6:uat
npm test
npm run lint
npx tsc --noEmit
npm run build
```

`phase7:audit` is read-only. It queries live Odoo/Studio configuration, normalizes the representative history, performs repeated rehearsal calculations, verifies checksums, and emits machine-readable JSON.
