# Odoo Studio Persistence and API Plan

## Deployment Boundary

Odoo Online 19 cannot run the project's custom TypeScript or a deployable Python addon. Studio stores configuration, attribution, lifecycle, and immutable snapshot records. Next.js server-only services fetch Odoo data, normalize it, run the pure engine, and write approved records through JSON-2.

The idempotent provisioning command creates missing `ir.model`, `ir.model.fields`, role groups, ACLs, and record rules through JSON-2 after explicit confirmation. It stops on existing field mismatches and persistence fails closed until the complete schema verifies.

```powershell
npm run studio:inspect
$env:SUNLECTRIC_STUDIO_PROVISION='CONFIRM'; npm run studio:provision
```

The live verification evidence is recorded in `docs/incentives/PHASE2_LIVE_VERIFICATION.md`.

## Studio Models

| Purpose | Technical model | Important fields |
| --- | --- | --- |
| Preset identity | `x_sunlectric_incentive_preset` | `x_code`, `x_company_id`, `x_active`, `x_current_version_id` |
| Immutable preset version | `x_sunlectric_incentive_preset_version` | preset, version, status, rules JSON, checksum, locked |
| Effective employee preset | `x_sunlectric_incentive_assignment` | employee, version, company, date range, active |
| Expense attribution | `x_sunlectric_incentive_expense_assignment` | posted move, one employee, status, reason |
| Commission attribution | `x_sunlectric_incentive_commission_assignment` | account `211810` move line, one employee, status, reason |
| Owner resolution | `x_sunlectric_incentive_owner_resolution` | stable event key, one employee, status, reason |
| Manual adjustment | `x_sunlectric_incentive_adjustment` | calculation, employee, month, operation, amount, reason |
| Calculation snapshot | `x_sunlectric_incentive_calculation` | employee/month/revision, state, checksums, snapshots, totals |
| Calculation source | `x_sunlectric_incentive_calculation_source` | calculation, source model/id/category, signed amount, snapshot |
| Payment | `x_sunlectric_incentive_payment` | approved calculation, amount, date, reference |

Exact technical fields, types, selections, required states, currency fields, and relations are centralized in `src/lib/incentives/odoo/studio-schema.ts`. Presets are formally validated against Draft 2020-12 `preset.schema.json`; JSON snapshots use long Text fields and are parsed and checksummed by the server.

## Constraints

- One effective preset assignment per employee/company/date.
- One active expense assignment per accounting move; no split amount field.
- One active commission assignment per commission move line.
- One active manual owner resolution per stable customer event key.
- Used/active preset versions are locked; edits create a new version.
- Employee/month/revision is unique for calculations.
- Approved calculations are immutable; corrections create a new revision with `x_supersedes_id`.
- Payments reference approved calculations and never alter calculation snapshots.

Studio configuration should add uniqueness where available. Next.js repositories re-check these constraints before writes because Studio does not provide custom Python/SQL constraints.

## Server API Flow

```text
Studio assignments/resolutions
  + posted Odoo accounting/history
  -> fetchIncentiveSourceBundle
  -> normalizeOdooIncentiveData
  -> prepareIncentiveEngineInput
  -> calculateIncentives
  -> review/resolution
  -> server re-fetch + same-engine recalculation
  -> StudioIncentiveRepository.recordApprovedCalculation
```

The server API returns normalized engine input, unresolved sources, and source-audit rows separately. Unresolved expenses, commissions, customer owners, or salesperson-to-employee mappings block approval and are never guessed.

Phase 3 adds protected Incentives HTTP routes after resolving application authentication. Odoo credentials create a signed Next.js session, and every request revalidates the Odoo user, company, employee mapping, and role groups before calling this repository. See `docs/incentives/PHASE3_SECURITY_API.md`.

## Accounting Normalization

- Customer moves: posted `out_invoice` and `out_refund` only.
- Sales: `-balance` for `account_type = income`.
- COGS: `balance` for `account_type = expense_direct_cost`.
- Refunds: naturally negative Sales and negative COGS; counted once.
- Transport/loading: signed move-level values from the two confirmed Studio fields.
- Automatic employee expense: posted expense/direct-cost line with `expense_id -> hr.expense.employee_id`.
- Manual employee expense: explicitly assigned posted move, exactly one employee, no split.
- Commission: posted account `211810` line with exactly one explicit employee assignment.
