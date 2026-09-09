# Sunlectric Incentive Engine Design

## Status and Authority

This is the final pre-runtime design contract. It reflects the final master specification and the live Odoo inspection recorded in `ODOO_INSPECTION.md`.

Runtime implementation must preserve these boundaries:

```text
Odoo authoritative data and persistence
  -> Next.js server authentication, authorization, pagination, normalization
  -> pure TypeScript engine in a browser Web Worker
  -> review and resolution UI
  -> server-side authoritative recalculation
  -> immutable approved Odoo snapshot
```

- The same pure engine runs in the Worker and on the server.
- Client totals are never trusted at approval.
- Odoo credentials never reach the browser, Worker, IndexedDB, logs, or exports.
- IndexedDB is a read cache only.
- V1 uses no external database.
- One approvable calculation represents one employee and one calendar month.

## Flat and Slab Separation

`mainIncentive.structure` is either `flat` or `slab`. The two configurations are mutually exclusive in `preset.schema.json`.

### Flat-only behavior

- Threshold source is monthly Odoo wage multiplied by a configurable multiplier.
- Carry-forward is configurable.
- Rate is one configurable flat rate.
- Payout basis is `entire_eligible_base` or `above_threshold_only`.
- Previous-base payout is `current_month_only` or `include_previous_unpaid_base`.

### Slab-only behavior

- There is no separate Flat salary threshold or Flat rate.
- Slab threshold type is `fixed_amount` or `salary_multiple`.
- Each slab is `minimum threshold -> rate`; no upper bounds are stored.
- Highest matching minimum threshold wins.
- V1 applies the selected rate to the whole current recognized base.
- V1 is non-progressive.
- Carry is based on the first slab threshold.
- Slab has no previous-base payout and no above-threshold-only option.

The administration UI must render only the controls belonging to the selected structure.

## Preset Configuration

- Machine schema: `preset.schema.json`
- First production configuration: `initial-standard-preset.json`
- Decimal rates are fractions: `0.10` is 10%.
- Schema validation handles structural exclusivity.
- Domain validation additionally rejects unordered or duplicate slab thresholds, negative fixed thresholds, non-positive salary multipliers, and invalid rates.
- Activated or used versions are immutable.

New-customer and repeat-customer incentives are independently enabled. Disabling the new-customer payout does not disable global new-customer qualification when an enabled repeat rule requires that qualification.

For new-customer incentives, `company_global` defines customer-history and customer-level qualification scope only. After qualifying customers against company-wide history, the engine attributes each event to its resolved owner, groups events by employee and calendar month, and applies `minimumQualifyingCustomers` separately to each employee's group. The company-wide qualifying-customer total never unlocks bonuses for every employee.

The V1 ownership strategy for both customer incentives is `customer_owner`. The authoritative source is the commercial customer's Odoo salesperson/account-manager field:

```text
res.partner.commercial_partner_id
  -> res.partner.user_id
  -> hr.employee.user_id
```

Invoice salesperson is not a fallback. A missing or unmapped customer owner produces a pending customer event and blocks approval of the affected bonus.

Ownership is resolved at the incentive event date. `res.partner.user_id` has tracking enabled in this Odoo database. Historical ownership is reconstructed from the current value plus `mail.tracking.value` changes for the `res.partner.user_id` field, joined through `mail.message` to the commercial partner and change timestamp. The resolved owner user, employee, tracking source, and effective timestamp are copied into the approved snapshot.

An accounting event has a date but no reliable event time. If an owner change occurs on the same local calendar date, V1 uses the owner effective at the start of that day. If no owner exists at that point or the owner cannot map to an employee, the customer bonus remains pending resolution. The engine never substitutes invoice salesperson.

## Odoo Persistence Model

The inspected environment is Odoo Online 19 with Studio installed. V1 should therefore provision equivalent Studio `x_` models and fields. The logical names below remain the application/domain names.

### `sunlectric.incentive.preset`

Stable preset identity.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | Char | Display name |
| `code` | Char | Unique per company |
| `company_id` | Many2one `res.company` | Company boundary |
| `active` | Boolean | Availability |
| `current_version_id` | Many2one version | Current assignable version |
| `version_ids` | One2many version | History |

### `sunlectric.incentive.preset.version`

| Field | Type | Notes |
| --- | --- | --- |
| `preset_id` | Many2one preset | Parent |
| `version_number` | Integer | Monotonic version |
| `status` | Selection | `draft`, `active`, `superseded`, `retired` |
| `schema_version` | Char | JSON schema version |
| `rules_json` | Json/Text | Complete validated preset |
| `rules_checksum` | Char | SHA-256 of canonical JSON |
| `locked` | Boolean | True after activation or first use |
| `activated_by` / `activated_at` | Audit | Activation |

Unique key: preset plus version number. Only drafts may be edited.

### `sunlectric.incentive.assignment`

| Field | Type | Notes |
| --- | --- | --- |
| `employee_id` | Many2one `hr.employee` | Incentive employee |
| `salesperson_user_id` | Related Many2one `res.users` | Accounting/sales identity |
| `preset_version_id` | Many2one version | Exact rules |
| `date_from` | Date | Inclusive |
| `date_to` | Date | Inclusive; null is open-ended |
| `company_id` | Many2one company | Company boundary |
| `active` | Boolean | Assignment state |

The Next.js server rejects overlapping active assignments for the same employee/company. Approval requires exactly one effective assignment unless an authorized override and reason are persisted.

Only employees represented by `hr.employee` are in the incentive population. `VISHAL GANPAT HONMANE` is intentionally excluded until a real Odoo employee record exists; V1 creates no fake mapping or salary.

### Salary source

V1 does not create a duplicate salary model.

- Current wage: API field `hr.employee.wage` (a non-stored current-version value in this Odoo 19 database).
- Historical wage: stored `hr.version.wage` with `hr.version.date_version` and `employee_id`.
- V1 selects the latest version effective on or before the first day of the calendar month. Intra-month changes apply from the following month and are not prorated.
- The selected wage and source version ID are copied into every approved snapshot.

### `sunlectric.incentive.expense.assignment`

One qualifying expense move belongs to exactly one employee for incentive attribution. Splitting is prohibited. Expense-generated accounting lines use their Odoo relation automatically; unlinked vendor bills require an explicit manual assignment before inclusion.

| Field | Type | Notes |
| --- | --- | --- |
| `move_id` | Many2one `account.move` | Unique active bill assignment |
| `employee_id` | Many2one employee | Incentive owner |
| `source` | Selection | `hr_expense` or `manual` |
| `expense_id` | Many2one `hr.expense` | Required for `hr_expense` source |
| `status` | Selection | `assigned`, `reassigned`, `void` |
| `reason` | Char | Required for manual/reassignment |
| `assigned_by` / `assigned_at` | Audit | Audit |

For `hr_expense`, employee identity is locked to `account.move.line.expense_id -> hr.expense.employee_id`; corrections must be made in Odoo. For `manual`, an authorized user chooses one employee and provides a reason. The deductible amount is the signed balance of the move's posted P&L expense lines, excluding account `211810` to prevent commission double-counting. It is never a user-entered split amount. The assignment never changes accounting ownership.

### `sunlectric.incentive.commission.assignment`

| Field | Type | Notes |
| --- | --- | --- |
| `move_line_id` | Many2one `account.move.line` | Commission line |
| `employee_id` | Many2one employee | Incentive attribution |
| `status` | Selection | `assigned`, `reassigned`, `void` |
| `reason` | Char | Required because no native employee relation exists |
| `assigned_by` / `assigned_at` | Audit | Audit |

Live inspection confirms account `211810 Sales Commission Expense` is debit-positive and has no sale-line, expense, analytic, salesperson, or employee relation on any of its seven current lines. Its vendor partner is not an employee. A commission line is therefore `unresolved` until exactly one authoritative assignment exists; the engine never guesses from partner, creator, invoice salesperson, or text.

### `sunlectric.incentive.customer.owner.override`

Audited resolution for a qualifying event whose event-date Odoo owner is missing or cannot map to an employee. It is not an automatic override of valid `res.partner.user_id` history.

| Field | Type | Notes |
| --- | --- | --- |
| `commercial_partner_id` | Many2one partner | Global customer |
| `bonus_type` | Selection | `new_customer`, `repeat_customer` |
| `qualifying_event_key` | Char | Stable event/customer/window key |
| `employee_id` | Many2one employee | Selected owner |
| `strategy` | Selection | `manual_resolution` |
| `source_move_id` | Many2one move | Relevant first/repeat invoice |
| `reason` | Char | Required resolution reason |
| `assigned_by` / `assigned_at` | Audit | Audit |

### `sunlectric.incentive.adjustment`

| Field | Type | Notes |
| --- | --- | --- |
| `calculation_id` | Many2one calculation | Draft/revision |
| `employee_id` | Many2one employee | Employee |
| `month` | Date | First day of calendar month |
| `operation` | Selection | `add`, `deduct` |
| `amount` | Monetary | Positive magnitude |
| `reason` | Char | Required |
| `notes` | Text | Optional |
| `created_by` / `created_at` | Audit | Audit |

Adjustments occur after all normal and customer incentives. Approved adjustments are immutable.

### `sunlectric.incentive.calculation`

| Field | Type | Notes |
| --- | --- | --- |
| `employee_id` | Many2one employee | Employee |
| `month` | Date | First day of month |
| `preset_version_id` | Many2one version | Exact rules |
| `revision` | Integer | Monotonic revision |
| `supersedes_id` | Many2one calculation | Prior approved/rejected revision |
| `state` | Selection | `draft`, `calculated`, `resolution`, `reviewed`, `adjusted`, `approval_requested`, `approved`, `paid`, `superseded` |
| `engine_version` | Char | Engine build |
| `rules_checksum` | Char | Preset checksum |
| `input_checksum` | Char | Canonical normalized input checksum |
| `rules_snapshot_json` | Json/Text | Exact rules |
| `input_snapshot_json` | Json/Text | Source IDs and normalized inputs |
| `result_snapshot_json` | Json/Text | Full result/explanation |
| `salary_version_id` | Many2one `hr.version` | Historical wage source |
| `salary_used` | Monetary | Snapshot summary |
| `carry_in` / `carry_out` | Monetary | Carry state |
| `unpaid_base_in` / `unpaid_base_out` | Monetary | Flat configured state only |
| `actual_base` | Monetary | Signed base |
| `raw_incentive` | Monetary | Before manual adjustment |
| `adjustment_total` | Monetary | Signed adjustments |
| `final_incentive` | Monetary | Approved payable |
| calculated/reviewed/approved audit fields | Audit | Lifecycle |

Unique key: employee, month, revision. Approved/paid snapshots are immutable.

### `sunlectric.incentive.calculation.source`

Searchable links from a calculation snapshot to invoices, COGS, charges, credit notes, expenses, commissions, and customer events. The source record stores contribution amount, sign/category, source model/ID, and normalized details JSON.

### `sunlectric.incentive.payment`

Links one or more payment records to an approved calculation. Payment settles the approved value and never changes carry or unpaid-base state.

## Normalized Input

The pure engine has no Odoo dependency. Its input contains:

```ts
type IncentiveEngineInput = {
  employeeId: number;
  companyId: number;
  month: string;
  monthlyHistory: NormalizedMonth[];
  customerHistory: NormalizedCustomerEvent[];
  salaryHistory: NormalizedSalaryVersion[];
  preset: IncentivePresetV1;
  adjustments: NormalizedAdjustment[];
  priorApprovedCheckpoint: CalculationCheckpoint | null;
};
```

The worker receives normalized IDs, dates, and numbers only. It never receives credentials.

Customer qualification and ownership are separate normalized concepts:

```ts
type NormalizedNewCustomer = {
  customerId: number;
  commercialPartnerId: number;
  customerOwnerUserId: number | null;
  customerOwnerEmployeeId: number | null;
  customerOwnerEffectiveAt: string | null;
  customerOwnerSource: "current_partner" | "tracking_history" | "manual_resolution" | "unresolved";
  firstInvoiceId: number;
  firstInvoiceDate: string;
  firstMonth: string;
  firstMonthGlobalBilling: number;
  firstMonthGlobalGM: number;
  firstMonthGlobalGMPercent: number;
  newCustomerQualificationStatus: "qualified" | "not_qualified";
  payoutEligibility: "eligible" | "ineligible" | "pending_owner";
};

type NormalizedRepeatEvent = {
  customerId: number;
  commercialPartnerId: number;
  repeatInvoiceId: number;
  repeatInvoiceDate: string;
  repeatBillingAmount: number;
  repeatGM: number;
  repeatGMPercent: number;
  customerOwnerUserId: number | null;
  customerOwnerEmployeeId: number | null;
  customerOwnerEffectiveAt: string | null;
  customerOwnerSource: "current_partner" | "tracking_history" | "manual_resolution" | "unresolved";
  qualificationStatus: "qualified" | "not_qualified";
  payoutEligibility: "eligible" | "ineligible" | "pending_owner";
};
```

## Calculation State

```ts
type CalculationState = {
  lastProcessedMonth: string | null;
  carryShortfall: number;
  accumulatedUnpaidBase: number;
  consecutiveFailureCount: number;
  cycleSequence: number;
  lastRecognitionMonth: string | null;
};
```

Every result keeps separate:

- actual base
- carry in/out
- Flat normal threshold or Slab first threshold
- required threshold
- carry consumed
- current recognized base
- eligible incentive base
- slab selection base
- accumulated unpaid base, Flat only when configured

State is replayed across gap-free calendar months from the latest approved checkpoint. Zero-activity months are processed.

## Verified Odoo Normalization Sources

| Concept | Authoritative source |
| --- | --- |
| Incentive employee | `hr.employee` |
| User-to-employee mapping | `hr.employee.user_id = res.users.id` |
| Sales-order salesperson | `sale.order.user_id`; line trace through `sale.order.line.salesman_id` |
| Invoice salesperson | `account.move.invoice_user_id` |
| Journal-line sales trace | `account.move.line.sale_line_ids` |
| Customer identity | `account.move.commercial_partner_id` / `res.partner.commercial_partner_id` |
| Customer owner | event-date `res.partner.user_id`, mapped through `hr.employee.user_id` |
| Owner history | tracked `res.partner.user_id` changes in `mail.tracking.value` + `mail.message` |
| Current salary | `hr.employee.wage` |
| Historical salary | stored `hr.version.wage` and `hr.version.date_version` |
| Posted-state gate | `account.move.state = posted`; equivalently source lines require `account.move.line.parent_state = posted` |
| Customer invoices | posted `account.move.move_type = out_invoice` |
| Customer credit notes | posted `account.move.move_type = out_refund` |
| Accounting amounts | signed `account.move.line.balance`, with debit/credit retained for audit |
| Net sales | lines on posted customer invoices/refunds where `account.account.account_type = income` |
| COGS | lines on posted customer invoices/refunds where `account.account.account_type = expense_direct_cost`; observed account `60101000 Cost of Goods Sold` |
| Transport | `account.move.x_studio_transport_charges` |
| Loading | `account.move.x_studio_loading_charges` |
| Automatic employee expense | posted `account.move.line` with `expense_id`, P&L expense account type, then `hr.expense.employee_id` |
| Manual employee expense | explicitly assigned posted vendor move; signed P&L expense balances only; no split |
| Commission | posted line whose account code is `211810`, attributed by `sunlectric.incentive.commission.assignment` |

The exact V1 customer accounting domain is posted `out_invoice`/`out_refund` moves. Net sales uses account type `income`; observed accounts are `50103000`, `50102000`, `200110`, `200210`, and refund round-off `213202`. `income_other` and unrelated journals are not customer sales. COGS uses account type `expense_direct_cost` on those same customer moves; the observed COGS account is `60101000`. Account labels are retained for audit but are not classification rules.

The automatic expense domain is `parent_state = posted`, `expense_id != false`, and account type `expense` or `expense_direct_cost`; tax/asset/receivable/payable lines are excluded. The period date is the posted journal-line date. `hr.expense.state` is audit metadata, not an additional eligibility gate: posted accounting is the finalization rule. Current data contains 171 linked lines covering 159 expenses: 163 lines are posted and 160 of those are eligible P&L lines. All 159 expenses map to an employee and currently have `paid` state. Unlinked bills are excluded unless an authorized manual assignment exists. An incentive attribution never changes the bill or accounting owner and never splits one bill between employees.

The fixed posted-state gate applies to invoices, refunds, journal entries, expenses, commissions, and every accounting adjustment. It is a system accounting rule, not a preset option.

Phase 2 implements this boundary in `src/lib/incentives/odoo`:

- `extraction.ts` fetches complete paginated posted source records and history.
- `normalization.ts` converts Odoo signs and attribution into engine inputs without Odoo dependencies leaking into the engine.
- `studio-schema.ts` verifies every required Studio model/field and fails closed.
- `studio-repository.ts` persists explicit attributions, versioned presets, and immutable approved snapshots.
- `service.ts` prepares one employee's engine input plus unresolved-source and audit records.

Normal refunds are represented by negative `netSales` and negative `cogs` contributions. The engine continues to calculate `GrossMargin = NetSales - COGS`; refunds never enter `signedAccountingAdjustments`, so their effect is counted once.

## Actual Base

For month `m`:

```text
SalesEffect(line) = -line.balance
COGSEffect(line)  =  line.balance

NetSales_m   = sum SalesEffect for posted out_invoice/out_refund income lines
COGS_m       = sum COGSEffect for posted out_invoice/out_refund direct-cost lines
GrossMargin_m = NetSales_m - COGS_m

AdjustedGM_m = GrossMargin_m
             - Transport_m
             - Loading_m
             + SignedStandaloneAccountingAdjustments_m

ActualBase_m = AdjustedGM_m
             - EmployeeExpenses_m
             - Commission_m
```

`out_refund` lines naturally reverse the signs: refund income has positive balance and reduces net sales; refund COGS has negative balance and reduces COGS. Because refunds are included in `NetSales` and `COGS`, they are never added again as standalone adjustments. Transport/loading are read from their Odoo move fields, null-normalized to zero, and deducted once from the move owner's GM. Employee expense and commission amounts use signed `balance`: debit-positive amounts reduce Actual Base and credit reversals restore it.

Standalone discounts, bad debts, pricing corrections, or miscellaneous journals are not auto-classified in V1 without an explicit approved source mapping. This prevents label-based guesses and double-counting.

`ActualBase` remains signed. Negative values are never floored before threshold or carry calculations.

Manual adjustments do not change `ActualBase`; they apply after calculated incentives.

## Flat Formulas

Definitions:

```text
W_m = Odoo wage applicable to month m
M   = configured salary multiplier
T_m = W_m × M                         normal threshold
C_m = carry in
B_m = signed actual base
U_m = accumulated previous unpaid base

R_m = carry enabled ? T_m + C_m : T_m
Met_m = B_m >= R_m
```

Carry:

```text
CarryOut_m =
  carry disabled: 0
  threshold met:  0
  threshold failed: R_m - B_m
```

Because `B_m` is signed, a negative base increases carry. Example: `120,000 - (-70,000) = 190,000`.

Previous unpaid base:

```text
If previousBasePayout = current_month_only:
  CandidateBase_m = B_m
  UnpaidBaseOut_m = 0

If previousBasePayout = include_previous_unpaid_base:
  CandidateBase_m = U_m + B_m
  UnpaidBaseOut_m = Met_m ? 0 : U_m + B_m
```

Payout basis after the threshold is met:

```text
If payoutBasis = entire_eligible_base:
  EligibleBase_m = Met_m ? CandidateBase_m : 0

If payoutBasis = above_threshold_only:
  EligibleBase_m = Met_m ? max(0, CandidateBase_m - R_m) : 0

MainIncentive_m = EligibleBase_m × configured flat rate
```

Recognition occurs when `Met_m` is true and closes the current cycle. Configured unpaid base resets immediately on recognition so historical base cannot be paid twice. Payment later settles the immutable recognition and does not control the reset.

## Slab Formulas

Slab thresholds for month `m`:

```text
Fixed threshold slab:      Q_i,m = configured minimumBase_i
Salary-multiple slab:      Q_i,m = W_m × configured minimumMultiplier_i
FirstThreshold_m = minimum Q_i,m
```

Carry and eligibility:

```text
R_m = carry enabled ? FirstThreshold_m + C_m : FirstThreshold_m
Met_m = B_m >= R_m

CarryOut_m =
  carry disabled: 0
  threshold met:  0
  threshold failed: R_m - B_m
```

When met, carry is consumed from current production:

```text
CarryConsumed_m = carry enabled ? C_m : 0
CurrentRecognizedBase_m = B_m - CarryConsumed_m
SlabSelectionBase_m = CurrentRecognizedBase_m
```

Select the slab with the highest resolved `Q_i,m` satisfying:

```text
Q_i,m <= SlabSelectionBase_m
```

Then:

```text
EligibleBase_m = Met_m ? CurrentRecognizedBase_m : 0
MainIncentive_m = EligibleBase_m × achieved slab rate
```

Slab never includes previous-month actual base, never stores unpaid payout base, never deducts another threshold from recognized base, and is never progressive in V1.

## Customer Qualification

Customer identity uses `commercial_partner_id` and company scope. Customer bonus ownership uses the commercial partner's `user_id` effective on the event date, mapped to the employee whose `hr.employee.user_id` matches that owner user.

Event-date owner reconstruction:

1. Start with the commercial partner's current `user_id`.
2. Load tracked changes for the `res.partner.user_id` field through `mail.tracking.value.mail_message_id -> mail.message`, converting timestamps to the company timezone.
3. The event-date instant is local start-of-day. Reverse every change whose local calendar date is equal to or later than the event date. This deterministically returns the owner effective at the start of a same-day event.
4. Map the recovered `res.users` ID to `hr.employee.user_id`.
5. Mark the event `pending_owner` if history or employee mapping is insufficient. An authorized manual resolution may later supply the owner with an audit reason; no automatic fallback is allowed.

For a company's globally first invoice calendar month:

```text
GlobalFirstMonthBilling = sum customer net billing across all salespeople
GlobalFirstMonthGM      = sum customer GM across all salespeople
GlobalFirstMonthGM%     = GM / billing × 100, or 0 when billing is zero
```

The initial standard preset qualifies only when billing is strictly greater than `100,000`, GM% is at least `3.5`, and the customer-level conditions pass. An employee receives the monthly new-customer bonus only when at least three qualifying customers resolve to that employee through the configured ownership strategy. When the employee minimum is met, every qualifying customer in that employee's group earns `bonusPerCustomer`; otherwise that employee earns zero new-customer bonus for the month.

Global customer amounts determine qualification only; they are not added to any employee's main incentive base.

The engine persists first invoice, first date, qualifying month, global billing/GM, qualification result, event-date customer owner user, mapped owner employee, and tracking evidence. First invoice salesperson remains trace data only and never determines V1 ownership.

Repeat qualification uses global customer history, the configured day window, optional billing/GM requirements, and configured maximum payouts. New and repeat payouts are independently enabled and their ownership strategies remain independently configurable. V1 resolves both through the customer owner, not the invoice salesperson.

If `newCustomer.enabled` is false while repeat is enabled and requires a qualified new customer, the engine still computes global new-customer qualification but emits no new-customer payout.

## Final Incentive

```text
CalculatedIncentive = MainIncentive
                    + AllocatedNewCustomerBonus
                    + AllocatedRepeatCustomerBonus

AdjustmentTotal = sum(additions) - sum(deductions)
FinalIncentive = CalculatedIncentive + AdjustmentTotal
```

Qualifying customer events whose event-date `res.partner.user_id` is missing or cannot map to `hr.employee.user_id` are displayed as pending and block approval; they never fall back to invoice salesperson.

## Failure State

```text
FailureCountOut = Met ? 0 : FailureCountIn + 1
Notice = configured enabled
         and FailureCountOut >= configured consecutive months
```

Supplier-unavailability remains a future/manual exception and is not inferred automatically.

## Lifecycle

1. **Draft**: resolve employee, month, salary version, and effective preset version.
2. **Calculated**: fetch normalized Odoo data and run the Worker over required history.
3. **Resolution**: resolve manually eligible unlinked expenses, all unmapped commission lines, and pending customer owners. No unresolved source can proceed to approval.
4. **Reviewed**: reviewer verifies sources, signs, state transition, and explanation.
5. **Adjusted**: authorized changes are stored separately; raw calculation remains visible.
6. **Approval requested**: client submits source IDs/checksums and displayed result.
7. **Approved**: server re-fetches authoritative data, reruns the same engine, rejects mismatches, and stores immutable rules/input/result snapshots.
8. **Revision**: corrections create a new linked revision; prior approved snapshots remain unchanged.
9. **Paid**: payment records settle the approved revision.

## Required Test Contract

Using test wage `20,000` only as fixture data:

### Flat, carry, current month only

```text
Threshold 120,000; rate 10%
Month 1 base 80,000 -> carry 40,000; incentive 0
Month 2 base 160,000 -> required 160,000; eligible 160,000; incentive 16,000
```

### Flat, carry, previous base included

```text
Month 1 base 80,000 -> unpaid base 80,000; carry 40,000
Month 2 base 160,000 -> eligible 240,000; incentive 24,000
Carry and unpaid base reset to zero
Month 3 cannot include Month 1 or Month 2 again
```

### Flat, above threshold only

```text
Required 120,000; actual 200,000; eligible 80,000; incentive 8,000
```

### Flat, above threshold with carry

```text
Month 1 base 80,000 -> carry 40,000
Month 2 actual 200,000; required 160,000; eligible 40,000; incentive 4,000
```

### Slab with carry

```text
Fixed slabs 120,000 -> 10%; 150,000 -> 12.5%; 180,000 -> 15%
Month 1 base 80,000 -> carry 40,000
Month 2 base 160,000 -> recognized 120,000 -> rate 10%
Eligible 120,000 -> incentive 12,000
Month 1 base is not paid or used to raise the slab
```

### Additional mandatory tests

- Fixed slabs choose the highest matching minimum threshold.
- Salary-multiple slab thresholds resolve from that month's historical Odoo wage.
- Negative Flat base `-70,000` against `120,000` produces carry `190,000`.
- Negative Slab base increases first-threshold carry equivalently.
- Slab validation rejects negatives, duplicates, unordered thresholds, mixed semantics, missing lists, and invalid rates.
- Global first-month billing aggregates multiple salespeople without changing individual main bases.
- V1 customer-owner attribution uses commercial-partner `res.partner.user_id`, not invoice salesperson.
- A same-day owner change uses the owner effective at local start-of-day.
- Missing or unmapped customer owner stays pending and blocks the affected bonus approval without fallback.
- New and repeat incentive enablement is independent, including new OFF / repeat ON with qualification still computed.
- Future configurable new/repeat ownership strategies resolve independently.
- Repeat day 90 qualifies and day 91 fails.
- Repeat maximum payouts supports 1, 2, 3, and null/unlimited.
- Strict `gt`: `100,000` fails and `100,000.01` passes.
- Expense assignment rejects a second active employee for the same bill.
- Automatic expense normalization includes only posted expense-linked P&L lines and excludes tax/asset lines.
- One posted account `211810` line without an explicit employee assignment remains unresolved and blocks approval.
- Draft invoices, refunds, expenses, commissions, and journals contribute zero; posting the same source makes it eligible.
- A refund income balance reduces sales and refund direct-cost balance reverses COGS exactly once.
- Four failures trigger notice and a successful month resets the streak.
- Used preset mutation and overlapping assignment creation are rejected.
- Approved snapshots remain unchanged after live Odoo or preset changes.
- Server approval rejects tampered client totals.

## Security and Authorization

Phase 3 provides Odoo-backed application authentication and route authorization. The signed session contains only the Odoo user ID and CSRF secret; each request revalidates the active user, company, employee mapping, and exact Incentive group membership from Odoo.

- Every server route validates an authenticated identity and role.
- Employee IDs, preset IDs, source IDs, adjustments, and totals from clients are untrusted.
- Preset editing, assignment, expense/commission/customer ownership resolution, adjustment, review, approval, and payment each require explicit permissions.
- Approved snapshot writes use server-refetched rules and inputs.
