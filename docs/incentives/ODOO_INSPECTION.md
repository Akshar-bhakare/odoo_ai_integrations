# Phase 1 Odoo Inspection

Initial inspection date: 2026-08-17. Restored-access inspection: 2026-08-18. Credit-note verification: 2026-08-19. All Odoo queries were read-only through the existing server credentials. No credential values are recorded here.

## Connection and Company Context

- The restored API key authenticates successfully through the existing JSON-2 endpoint with HTTP 200.
- Current database company: `SUNLECTRIC PRIVATE LIMITED` (`res.company` ID 1).
- Company currency/country: INR / India.
- User context language/timezone: `en_IN` / `Asia/Calcutta`.
- `.env.local` uses `ODOO_API_KEY`; no `NEXT_PUBLIC_*` Odoo credential exists.
- `src/lib/odoo/client.ts` reads the key through server-side `process.env` only.
- End-to-end smoke test through the existing `/api/odoo/orders` route succeeded and returned 100 orders through `src/lib/odoo/client.ts`.

## Environment and Persistence

- Odoo version: 19 Online/SaaS trial environment.
- `web_studio` is installed.
- Twelve existing Studio `x_` models are visible.
- The environment is routed through Odoo's SaaS trial controller; a deployable custom Python addon should not be assumed.
- V1 persistence should therefore use Studio-created `x_` models/fields corresponding to the logical models in `DESIGN.md`.
- Cross-record overlap, immutability, checksum, and approval constraints must be enforced by authorized Next.js APIs and supported by Odoo ACLs/automations because Studio models do not provide the same custom Python/SQL constraint surface as an addon.

## Existing Application

- The Next.js app already has a server-only JSON-2 Odoo client and API routes.
- The Odoo bearer key is currently read only on the server.
- Existing Orders routes use `sale.order`, `account.move`, `account.move.line`, and attachments.
- List fetching currently uses fixed limits rather than complete pagination.
- There is no application authentication middleware, session layer, or route-level authorization.
- Existing debug and accounting routes must not remain publicly callable in a production deployment.

## Employee Identity

- `hr.employee.user_id` links employees to `res.users` salespeople.
- Nine employee records are visible; eight have a user link and one does not.
- Recent invoice inspection found `account.move.invoice_user_id` populated on all 30 sampled posted customer invoices.
- For 39 sampled invoice journal lines with `sale_line_ids`, `sale.order.line.salesman_id` matched the invoice salesperson in all 39 cases.
- Main sales-performance normalization may use `account.move.invoice_user_id`, with sale-line salesperson retained as a trace/consistency source. Customer new/repeat bonuses use customer owner instead.
- The reference export contains historical salesperson `VISHAL GANPAT HONMANE` through 2026-08-04, but no matching `hr.employee` exists, even with archived records included. A real Odoo employee/wage mapping would be required only if he is included in a future incentive population.
- Per the confirmed V1 rule, Vishal is outside the current incentive population until a real `hr.employee` is created. No fake mapping or salary is required.
- `UMESH NAGARE` appears only before the current scheme period in the supplied export and also has no employee record.

## Salary and History

- Current salary is readable from `hr.employee.wage`; metadata shows it is a non-stored current-version value.
- All nine current test employees have wage `20,000`; this is test data, not a rule.
- Odoo 19 uses `hr.version` as the Employee Contract/version model; `hr.contract` does not exist.
- `hr.version.wage` is stored, with stored `employee_id` and `date_version` fields.
- Every current employee has one visible version. The model supports historical versions, but this database does not yet contain a real multi-version wage-change example to verify operational behavior.
- V1 should resolve historical wage from `hr.version`; no duplicate incentive salary model is proposed.
- The approved V1 policy selects the wage version effective on the first day of each calendar month and performs no proration.
- All nine test employees currently return `hr.employee.wage = 20,000` through the API.

## Invoice, Sales, COGS, and Charges

- `account.move` exposes `commercial_partner_id`, `invoice_user_id`, `move_type`, `state`, and company.
- `account.move.line` exposes `account_id`, `account_type`, `move_id`, `partner_id`, `sale_line_ids`, debit, credit, balance, and stored `parent_state`.
- `account.account` exposes account code and account type, allowing account-type/configuration-based normalization rather than label-only matching.
- Both required charge fields exist and are stored floats:
  - `account.move.x_studio_transport_charges`
  - `account.move.x_studio_loading_charges`
- All 1,224 currently visible customer invoice/refund records contain zero charge values, but the fields are available and nullable values can normalize to zero.
- Customer identity can use `account.move.commercial_partner_id` / `res.partner.commercial_partner_id`, avoiding child-contact duplication.
- Current move counts are 1,208 posted customer invoices, 14 posted customer refunds, and 2 cancelled customer invoices. Draft/cancelled records are excluded.
- The exact posted gate is `account.move.state = posted`; source-line queries use the equivalent stored `account.move.line.parent_state = posted`.
- The exact customer-sales domain is posted `out_invoice`/`out_refund` lines whose account type is `income`. Observed accounts are `50103000 Sales Income - Material`, `50102000 Sales Income - INC`, `200110 Local Sales`, `200210 Local Services`, and refund round-off `213202`.
- The exact COGS domain is posted `out_invoice`/`out_refund` lines whose account type is `expense_direct_cost`. The observed account is `60101000 Cost of Goods Sold`.
- Signed normalization uses `account.move.line.balance`: `SalesEffect = -balance`, `COGSEffect = balance`, and `GrossMargin = SalesEffect - COGSEffect`.
- Across current posted customer moves, invoice income is credit/negative, invoice COGS is debit/positive, refund income is debit/positive, and refund COGS is credit/negative. Refunds therefore reverse both components naturally and must not be added a second time as adjustments.

## Customer Owner / Account Manager

- The exact Odoo field is `res.partner.user_id`.
- Odoo metadata describes it as **Salesperson**; it is a stored Many2one to `res.users`.
- Customer incentives must resolve the commercial entity first, then read its owner:

```text
account.move.commercial_partner_id
  -> res.partner.user_id
  -> hr.employee where hr.employee.user_id matches
```

- `account.move.invoice_user_id` and sale-order salesperson are separate invoice-processing identities and are not customer-incentive ownership fallbacks.
- Missing `res.partner.user_id` or a user without a matching employee produces an unresolved customer bonus.
- `res.partner.user_id` has tracking level 4. Odoo contains 175 owner tracking rows covering 150 partners through `mail.tracking.value` and `mail.message`.
- Event-date ownership can be reconstructed by starting with current `user_id` and reversing tracked changes through the local start of the event date.
- Across 1,207 posted customer invoices/refunds since 2025-08-01:
  - 217 events resolve to an owner with a matching employee;
  - 36 resolve to an owner without an employee mapping;
  - 954 have no owner at the event date;
  - 5 events have a mapped customer owner different from invoice salesperson;
  - 28 events share the calendar date of an ownership change; the confirmed V1 rule uses the owner effective at local start-of-day.
- Among 264 customers' first events, 78 owners map to employees, 10 owners lack an employee, and 176 have no owner at the first event.
- Current customer records also have substantial missing-owner data, so historical customer bonuses require owner backfill/resolution before approval.

## Employee Expenses

- `account.move.expense_ids` and stored `account.move.line.expense_id` exist.
- `hr.expense.employee_id` provides authoritative employee attribution for expense-generated bills.
- `hr.expense` exposes stored `state`, `date`, `employee_id`, `account_id`, `product_id`, amount, company, and currency fields. Odoo labels `product_id` as Category.
- Full live inspection found 171 lines with an expense relation: 163 posted and 8 cancelled. They cover 159 expenses; all 159 have an employee and currently have state `paid`. Of the posted lines, 160 are P&L expense/direct-cost lines and 3 are tax/asset lines excluded by the V1 domain.
- Expense dates differ from posted journal-line dates on 168 of 171 lines. V1 uses the posted journal-line date for accounting-period deduction and retains the expense date for audit.
- The exact automatic domain is `account.move.line.parent_state = posted`, `expense_id != false`, and account type in `expense`/`expense_direct_cost`. This includes signed P&L expense balances and excludes tax, fixed-asset, current-asset, receivable, and payable lines.
- `hr.expense.state` is audit metadata, not a second eligibility filter. The fixed posted-accounting rule controls inclusion, so payment timing does not move an expense between incentive months.
- Unlinked vendor bills are excluded by default. An authorized user may explicitly mark an employee-related posted bill and assign it to exactly one employee through the Studio expense-assignment model. No amount split or partner-name inference is allowed.

## Commission

- Account code `211810` exists as `Sales Commission Expense` with account type `expense`.
- Seven posted lines totaling `132,326` were found; they are debit-positive vendor-bill lines and all appear to be sales commission entries.
- The lines have no sale-line, expense, analytic, invoice salesperson, employee, or user attribution relation.
- Their three partners are commission vendors, not employees, so employee ownership cannot be inferred reliably.
- The reference XLSX contains six such lines totaling `127,126`; the seventh live line is outside the export's date window.
- V1 source is the posted signed balance of account `211810`. Debit-positive balance reduces Actual Base; a future credit/reversal would restore it. Every current line remains unresolved until exactly one Studio commission-assignment record identifies the employee.

## Global Customer Qualification Data

- Commercial customer history can be reconstructed from posted `account.move` records grouped by `commercial_partner_id`.
- First invoice/date, first calendar month, global billing, global COGS/GM/GM%, later invoices, repeat dates, repeat billing, and repeat GM are all derivable from the inspected fields.
- The current dataset contains 264 commercial customers with reconstructable first-month accounting data.
- As a data-availability check only, 114 meet the initial `billing > 100,000` and `GM% >= 3.5` conditions, and 119 have a later invoice within 90 days. These counts are not hard-coded rules or approved payout results.

## Credit Notes and Adjustments

- Customer credit notes are discoverable through `account.move.move_type = out_refund`.
- The reference export contains 14 credit notes / 45 lines across Sales Income, COGS, and round-off accounts.
- Invoice/refund salesperson and commercial partner can be sourced from `account.move` rather than name parsing.
- Posted normal refunds are already included once in signed sales/COGS aggregation. Draft/cancelled refunds are excluded.
- Standalone discounts, returns, pricing corrections, bad debts, and miscellaneous journals have no approved automatic V1 source mapping yet and must not be guessed from labels.

### Posted invoice/refund verification

All 14 live posted refunds have `account.move.invoice_user_id`; all 14 also have sale-line salesperson traces, and the two sources match. Four refunds have `reversed_entry_id`; the remaining refunds still carry authoritative posted income/COGS lines and salesperson traces.

Clean linked pair inspected:

| Move | Type | Income balance | Normalized Sales | COGS balance | Normalized COGS | Gross Margin effect |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `SL/FY25-26/174` (`id=1658`) | `out_invoice` | `-47,200` | `+47,200` | `+37,100` | `+37,100` | `+10,100` |
| `RMHD/25-26/0006` (`id=1659`) | `out_refund` | `+47,200` | `-47,200` | `-37,100` | `-37,100` | `-10,100` |

The exact normalization is:

```text
SalesEffect = -account.move.line.balance  for account_type = income
COGSEffect  =  account.move.line.balance  for account_type = expense_direct_cost
GrossMarginEffect = SalesEffect - COGSEffect
```

The linked refund therefore deducts both Sales and Gross Margin and fully reverses the linked invoice. It is not copied into `signedAccountingAdjustments` and no second manual deduction is applied.

Across all 14 refunds, signed COGS valuation can differ from refunded Sales. Two refunds have a positive GM effect because the posted COGS reversal exceeds the Sales reversal; this is the mathematically correct reversal of the posted accounting/valuation and must remain visible for review rather than being forced into an extra deduction. The other 12 reduce GM. V1 preserves the signed Odoo result exactly once.

## Reference Files

- `Journal Item (account.move.line).xlsx`, the agreement, and the legacy Python application are present.
- `Invoice Charges May 2026.xlsx` is not present in the repository or supplied attachment directories. It is not required for production because Odoo charge fields replace it, but it remains unavailable as a legacy parity fixture.

## Customization Capability

- `web_studio` version `19.0.1.0` is installed.
- Twelve existing Studio `x_` models are visible through the API.
- The environment identifies as Odoo Online/SaaS rather than Odoo.sh/on-premise.
- V1 must use Studio `x_` models/fields for persistence; a deployable custom Python module is not available in this environment.
