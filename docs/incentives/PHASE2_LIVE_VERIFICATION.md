# Phase 2 Live Odoo Studio Verification

Verification date: 2026-08-19. Environment: Odoo Online 19, company `SUNLECTRIC PRIVATE LIMITED` (`res.company(1)`). Provisioning and verification used the JSON-2 API with Odoo user `res.users(2)`. No deployable Python module or external database was used.

## Live Models and Fields

All ten models exist with `state = manual`. The live schema contains 117 approved custom fields and passes exact type, required-state, selection, currency-field, and relation verification against `studio-schema.ts`.

| Live model ID | Technical model | Custom fields |
| --- | --- | --- |
| 1754 | `x_sunlectric_incentive_preset` | `x_name`, `x_code`, `x_company_id`, `x_active`, `x_current_version_id` |
| 1756 | `x_sunlectric_incentive_preset_version` | `x_name`, `x_preset_id`, `x_company_id`, `x_version_number`, `x_status`, `x_schema_version`, `x_rules_json`, `x_rules_checksum`, `x_locked`, `x_activated_by_id`, `x_activated_at` |
| 1758 | `x_sunlectric_incentive_assignment` | `x_name`, `x_employee_id`, `x_preset_version_id`, `x_date_from`, `x_date_to`, `x_company_id`, `x_active` |
| 1760 | `x_sunlectric_incentive_expense_assignment` | `x_name`, `x_move_id`, `x_employee_id`, `x_company_id`, `x_currency_id`, `x_attributed_amount`, `x_status`, `x_reason`, `x_notes` |
| 1762 | `x_sunlectric_incentive_commission_assignment` | `x_name`, `x_move_line_id`, `x_employee_id`, `x_company_id`, `x_currency_id`, `x_attributed_amount`, `x_status`, `x_reason`, `x_notes` |
| 1764 | `x_sunlectric_incentive_owner_resolution` | `x_name`, `x_event_key`, `x_employee_id`, `x_company_id`, `x_status`, `x_reason`, `x_notes` |
| 1766 | `x_sunlectric_incentive_adjustment` | `x_name`, `x_calculation_id`, `x_employee_id`, `x_company_id`, `x_currency_id`, `x_month`, `x_operation`, `x_amount`, `x_reason`, `x_notes` |
| 1768 | `x_sunlectric_incentive_calculation` | `x_name`, `x_employee_id`, `x_company_id`, `x_currency_id`, `x_month`, `x_period_start`, `x_period_end`, `x_preset_version_id`, `x_revision`, `x_supersedes_id`, `x_state`, `x_engine_version`, `x_rules_checksum`, `x_input_checksum`, `x_rules_snapshot_json`, `x_input_snapshot_json`, `x_result_snapshot_json`, `x_threshold_state_json`, `x_slab_state_json`, `x_carry_state_json`, `x_salary_version_id`, `x_salary_source_key`, `x_salary_used`, `x_carry_in`, `x_carry_out`, `x_unpaid_base_in`, `x_unpaid_base_out`, `x_actual_base`, `x_raw_incentive`, `x_adjustment_total`, `x_final_incentive`, `x_reviewed_by_id`, `x_reviewed_at`, `x_approved_by_id`, `x_approved_at`, `x_payment_state`, `x_paid_amount`, `x_review_notes` |
| 1770 | `x_sunlectric_incentive_calculation_source` | `x_name`, `x_calculation_id`, `x_company_id`, `x_currency_id`, `x_source_model`, `x_source_record_id`, `x_source_key`, `x_source_category`, `x_signed_amount`, `x_source_snapshot_json` |
| 1772 | `x_sunlectric_incentive_payment` | `x_name`, `x_calculation_id`, `x_company_id`, `x_currency_id`, `x_amount`, `x_payment_date`, `x_reference`, `x_status`, `x_recorded_by_id`, `x_recorded_at`, `x_notes` |

Odoo's standard audit fields `create_uid`, `create_date`, `write_uid`, and `write_date` are available on every model. They provide the required creator and timestamp audit trail without duplicate custom fields.

## Relations

- Preset identity links to company and current preset version.
- Preset versions link to preset, company, and activation user.
- Employee assignments link one employee to one immutable preset version and company over an effective date range.
- Expense attribution links one posted `account.move` to zero or one unresolved/assigned employee, company, and currency. No amount-splitting relation exists.
- Commission attribution links one posted account `211810` `account.move.line` to zero or one employee, company, and currency.
- Adjustments link to calculation, employee, company, and currency.
- Calculations link to employee, company, currency, preset version, optional superseded calculation, optional `hr.version`, reviewer, and approver. `x_salary_source_key` represents current `hr.employee.wage` when no `hr.version` record exists.
- Source rows link to calculation, company, and currency while retaining source model, source record ID, stable key, category, signed amount, and immutable JSON snapshot.
- Payments link to one approved calculation, company, currency, and recording user. They do not write calculation state, carry, snapshots, or preset records.

## Roles and Permissions

| Group ID | Odoo group | Permission intent |
| --- | --- | --- |
| 161 | `Sunlectric Incentives / Employee` | Read presets and only own assignments, calculations, sources, and payments through record rules |
| 162 | `Sunlectric Incentives / Reviewer` | Read all incentive records; write expense, commission, owner resolution, and draft adjustment records |
| 163 | `Sunlectric Incentives / Approver` | Implies Reviewer; approval is allowed only through the server authorization layer |
| 164 | `Sunlectric Incentives / Administrator` | Implies Approver and Payment Recorder; full model administration subject to global immutability rules |
| 165 | `Sunlectric Incentives / Payment Recorder` | Read calculations/sources and create payment settlement records |

The live database contains 29 model ACLs and nine record rules. Global rules prevent writes/unlinks to locked preset versions, approved/superseded calculations, and their adjustments/source rows. Payments can only reference approved calculations. Employee rules restrict employee-visible assignment, calculation, source, and payment records to `hr.employee.user_id = user.id`.

## Live Persistence Test

The controlled smoke run retained one clearly identified QA chain and removed all temporary assignments/resolutions:

- Preset `1` with active locked version `1` and newer draft version `2`.
- Approved calculation `1`, adjustment `1`, source audit row `1`, and payment `1`.
- Temporary employee assignment, expense attribution, commission attribution, and owner resolution counts returned to zero after verification.
- Test period is January 2099, preventing collision with operational calculations.

Verified operations:

1. Create preset and draft version.
2. Validate rules against Draft 2020-12 `preset.schema.json`, then store canonical JSON and its SHA-256 checksum.
3. Update draft rules and restore the approved QA rules.
4. Activate and lock version 1.
5. Reject mutation through both repository validation and a direct JSON-2 write.
6. Create version 2 rather than mutating version 1.
7. Create an employee assignment and reject an overlapping assignment.
8. Attribute one posted employee expense and reject duplicate attribution.
9. Attribute one posted account `211810` commission line and reject duplicate attribution.
10. Resolve one owner event and reject duplicate resolution.
11. Create a draft calculation, adjustment, and linked source audit row.
12. Recalculate with the pure TypeScript engine during approval and store checksums/snapshots.
13. Reject approved calculation mutation and post-approval adjustment.
14. Record payment and confirm input checksum, result snapshot, carry snapshot, and final incentive remain unchanged.
15. Reject overpayment.

## Mismatches Encountered

Provisioning stopped on two representational issues before persistence testing:

1. JSON-2 model creation generated optional `x_name` fields. The ten generated fields were made required, then the complete schema was reverified.
2. Current salary can come from `hr.employee.wage` without an `hr.version` record. `x_salary_version_id` was made optional and required `x_salary_source_key` was added. This preserves both current and historical salary provenance.

No live schema mismatch remains.

## Authentication Blocker

The Next.js application currently has no authenticated user/session mechanism and existing Odoo routes use one shared server API key. Consequently, no public Incentives HTTP endpoints were created. The repository requires an explicit authenticated actor, company membership, and role for every write, but a future authentication layer must map the signed-in application user to the five Odoo incentive groups before protected route handlers can be exposed.

Approved calculations are immutable in both the repository and live Odoo record rules. Corrections require a new revision linked through `x_supersedes_id`.
