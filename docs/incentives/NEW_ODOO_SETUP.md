# New Odoo Incentive Setup Report

Verification date: 2026-08-22  
Recreation specification: `docs/incentives/ODOO_RECREATION_GUIDE.md`  
Canonical schema: `src/lib/incentives/odoo/studio-schema.ts`

No records were migrated from the previous Incentive environment. No preset, preset version, employee assignment, attribution, adjustment, calculation, calculation source, or payment was created during this setup.

## 1. New Odoo URL

- URL: `https://akshar-sunlectric-22aug.odoo.com`
- Database: `akshar-sunlectric-22aug`
- JSON-2 authentication: successful with the server-side API key
- API key owner: `res.users(2)`, mapped to `hr.employee(1)` in company `1`
- Secrets remain only in `.env.local`; no key or password is recorded here.

## 2. Odoo version

- Server version: Odoo `19.0+e`
- Version series: `19.0`
- Hosting target: Odoo Online

## 3. Company

- Company: `SUNLECTRIC PRIVATE LIMITED`
- Company ID: `1` in this database only
- Country: India
- API integration user's current/allowed company includes company `1`.

The company name and IDs are environment-specific. Company consistency remains mandatory for employees, accounting records, presets, assignments, calculations, and payments.

## 4. Currency

- Currency: INR
- Currency ID: `20` in this database only
- Symbol: ₹
- Active: yes

## 5. Studio status

- Module: `web_studio`
- State: installed
- Installed version: `19.0.1.0`
- JSON-2 metadata access: sufficient to inspect and create `ir.model`, `ir.model.fields`, groups, ACLs, and record rules.

## 6. Native dependencies found

All required native models are present and readable by the integration user:

- `res.company`
- `res.currency`
- `res.users`
- `res.groups`
- `hr.employee`
- `hr.version`
- `hr.expense`
- `res.partner`
- `account.move`
- `account.move.line`
- `account.account`
- `mail.tracking.value`
- `mail.message`

All native fields referenced by authentication, extraction, and normalization were found:

- Employee: `hr.employee.name`, `company_id`, `active`, `user_id`, `wage`
- Salary history: `hr.version.company_id`, `employee_id`, `date_version`, `wage`
- Expense: `hr.expense.employee_id`, `date`, `state`
- Customer: `res.partner.name`, `commercial_partner_id`, `user_id`
- Move: `account.move.name`, `date`, `state`, `move_type`, `company_id`, `commercial_partner_id`, `invoice_user_id`, `reversed_entry_id`
- Move line: `account.move.line.move_id`, `date`, `parent_state`, `company_id`, `account_id`, `balance`, `debit`, `credit`, `expense_id`
- Account: `account.account.code`, `name`, `account_type`, `company_ids`
- Owner history: `mail.tracking.value.field_id`, `mail_message_id`, `old_value_integer`, `new_value_integer`, `create_date`; `mail.message.model`, `res_id`, `date`

Read-access checks succeeded for every model above.

## 7. Native dependencies missing

The initial inspection found only these two missing fields:

- `account.move.x_studio_transport_charges`
- `account.move.x_studio_loading_charges`

Both were created with their exact required technical names as optional, writable, stored `float` fields:

| Field | Label | Type | Stored | Required | Readonly |
|---|---|---|---:|---:|---:|
| `x_studio_transport_charges` | Transport Charges | Float | Yes | No | No |
| `x_studio_loading_charges` | Loading Charges | Float | Yes | No | No |

No required native model or extraction field remains missing.

## 8. Studio models created

The first confirmed `studio:provision` run created all 10 canonical models with `state=manual`:

| Model ID | Technical model | Display name |
|---:|---|---|
| 1786 | `x_sunlectric_incentive_preset` | Sunlectric Incentive Preset |
| 1788 | `x_sunlectric_incentive_preset_version` | Sunlectric Incentive Preset Version |
| 1790 | `x_sunlectric_incentive_assignment` | Sunlectric Incentive Employee Assignment |
| 1792 | `x_sunlectric_incentive_expense_assignment` | Sunlectric Incentive Expense Attribution |
| 1794 | `x_sunlectric_incentive_commission_assignment` | Sunlectric Incentive Commission Attribution |
| 1796 | `x_sunlectric_incentive_owner_resolution` | Sunlectric Incentive Owner Resolution |
| 1798 | `x_sunlectric_incentive_adjustment` | Sunlectric Incentive Adjustment |
| 1800 | `x_sunlectric_incentive_calculation` | Sunlectric Incentive Calculation |
| 1802 | `x_sunlectric_incentive_calculation_source` | Sunlectric Incentive Calculation Source |
| 1804 | `x_sunlectric_incentive_payment` | Sunlectric Incentive Payment |

All 10 custom models currently contain zero business records.

## 9. Studio fields created

The first run created 107 explicit fields. Odoo generated one `x_name` field for each model, and the provisioner made those generated fields required. Total verified canonical field count: **117**.

| Technical model | Verified custom fields |
|---|---:|
| `x_sunlectric_incentive_preset` | 5 |
| `x_sunlectric_incentive_preset_version` | 11 |
| `x_sunlectric_incentive_assignment` | 7 |
| `x_sunlectric_incentive_expense_assignment` | 9 |
| `x_sunlectric_incentive_commission_assignment` | 9 |
| `x_sunlectric_incentive_owner_resolution` | 7 |
| `x_sunlectric_incentive_adjustment` | 10 |
| `x_sunlectric_incentive_calculation` | 38 |
| `x_sunlectric_incentive_calculation_source` | 10 |
| `x_sunlectric_incentive_payment` | 11 |

Post-provision schema inspection result:

- ready: yes
- missing models: none
- missing fields: none
- field mismatches: none

The second confirmed provision run created nothing and still reported a ready schema. Provisioning is idempotent against this fresh instance.

## 10. Groups created

| Group ID | Exact group name | Current direct users |
|---:|---|---:|
| 161 | `Sunlectric Incentives / Employee` | 0 |
| 162 | `Sunlectric Incentives / Reviewer` | 0 |
| 163 | `Sunlectric Incentives / Approver` | 0 |
| 164 | `Sunlectric Incentives / Administrator` | 1 |
| 165 | `Sunlectric Incentives / Payment Recorder` | 0 |

Verified inheritance:

- Approver implies Reviewer.
- Administrator implies Approver.
- Administrator implies Payment Recorder.
- Administrator does not imply Employee.

The sole direct Administrator is the server integration/API-key user. No other user was granted Administrator during provisioning.

## 11. ACLs

- Expected ACLs: 29
- Live ACLs: 29
- Result: verified

The live ACL set matches the repository declarations:

- Employee: read presets/versions and own assignment/calculation/source/payment records, subject to employee rules.
- Reviewer: read all custom models; full CRUD on expense attribution, commission attribution, owner resolution, and adjustment.
- Approver: inherits Reviewer; approval remains server-authorized.
- Administrator: full custom-model CRUD subject to global record rules.
- Payment Recorder: read calculations/sources and CRUD payments.

## 12. Record rules

- Expected declared rules: 9
- Live declared rules: 9
- Result: exact names, domains, operation flags, and Employee-group binding verified

Global rules:

1. Locked preset versions are immutable.
2. Approved/superseded calculations are immutable.
3. Approved/superseded calculation adjustments are immutable.
4. Approved/superseded source audits are immutable.
5. Payments require an approved calculation.

Employee-group read rules:

6. Own assignments only.
7. Own calculations only.
8. Own calculation sources only.
9. Own payments only.

The existing provisioner does not add complete `x_company_id in company_ids` record rules to all 10 custom models. Application services enforce company scope, and this database currently has one active application company, but Odoo-level company isolation is still required before production/multi-company use.

## 13. Required manual configuration

Before creating the initial preset or running calculations:

1. Set approved wages for the intended incentive employees; current wages and salary-version wages are all ₹0.
2. Confirm which existing employees participate from September 2026.
3. Link a user for any participating employee without `hr.employee.user_id`.
4. Assign approved human users to Employee/Reviewer/Approver/Payment Recorder groups using least privilege.
5. Add and test Odoo-level company isolation rules for the 10 custom models.
6. Confirm the operational uniqueness controls described in `ODOO_RECREATION_GUIDE.md` where Studio supports them.
7. Review customer owners and event-date history for customers that may qualify after the policy start.
8. Configure future unattributed commission/expense sources before approval rather than guessing.

Menus, actions, and custom Studio views are optional because the Next.js application is the intended operational UI.

## 14. Employee prerequisites

Live active employees in company `1`: 9.

- Active employees with linked users: 8 of 9.
- Active employees with an `hr.version` effective on 2026-09-01: 9 of 9.
- Current `hr.employee.wage` values greater than zero: 0 of 9.
- Effective September `hr.version.wage` values greater than zero: 0 of 9.
- Human users directly assigned to the Employee group: 0.

Therefore salary field/schema availability is verified, but employee compensation and role setup are not calculation-ready. No employee or salary data was changed automatically.

## 15. Customer-owner prerequisites

The authoritative path remains:

`account.move.commercial_partner_id → res.partner.user_id → res.users → hr.employee.user_id`

Invoice salesperson is not a customer-incentive owner fallback.

Live history/readiness observations:

- Commercial customers represented in posted pre-policy billing: 289.
- Those customers with a current `res.partner.user_id`: 105.
- Distinct owner users mapped to active employees: 6.
- `res.partner.user_id` tracking level: 4.
- Historical owner tracking rows currently readable: 193.
- August 2026 application route found 95 unresolved customer-owner events.

Missing event-date ownership must remain pending or receive an authorized Owner Resolution later. No old owner-resolution records were migrated.

## 16. Accounting prerequisites

- Commission account `211810` exists as `Sales Commission Expense` with account type `expense`.
- Seven posted commission lines exist across the current database; six fall inside the repository inspection period from 2025-08 through 2026-08 and currently have no incentive attribution.
- The two transport/loading fields now exist; no posted move currently has a non-zero value in either field.
- Posted customer billing before 2026-09-01:
  - 1,318 posted customer invoices
  - 14 posted customer refunds/credit notes
  - 1,332 total posted billing documents
- Posted customer billing on or after 2026-09-01: 0 at verification time.
- Two draft/non-posted customer documents exist and are correctly excluded from customer history.

Repository inspection reconfirmed that signed refunds reverse Sales and COGS once. No accounting normalization or business-rule change was made.

## 17. Remaining blockers

Actual blockers before incentive setup/calculation:

1. **Salary data:** all nine current employee and salary-version wages are ₹0.
2. **Employee identity:** one active employee has no linked Odoo user; management must confirm whether that employee participates.
3. **Human roles:** only the integration user has an Incentive role; approved operational users still need least-privilege groups.
4. **Company record rules:** the nine declared rules are present, but complete custom-model company isolation remains manual.
5. **Customer ownership quality:** many historical customer events lack an employee-resolvable owner and would block affected customer bonuses.
6. **Credential-login test configuration:** server/API integration and protected reads pass, but a true human password login was not run because `ODOO_TEST_LOGIN` and `ODOO_TEST_PASSWORD` are not configured in `.env.local`.

Not blockers:

- Odoo/JSON-2 connectivity
- Odoo version or Studio availability
- native extraction model/field availability
- commission account availability
- transport/loading field availability
- Incentive Studio schema
- group inheritance, ACLs, or declared record rules
- repository reads
- TypeScript, ESLint, automated tests, or production build

## 18. Exact next setup step

Obtain management confirmation for the September 2026 incentive employee list, each employee's approved wage, employee/user mapping, and human role memberships. Apply those Odoo data/security changes, then create and activate the standard preset and create employee assignments with `x_date_from = 2026-09-01`.

Do not create any assignment dated before 2026-09-01.

### September 2026 policy boundary

The current design can safely represent the boundary without a schema or engine change:

- An employee assignment effective from `2026-09-01` makes the preset unavailable to the calculation API for earlier months.
- The custom calculation table is empty, so September starts without approved pre-policy carry or unpaid-base state.
- Customer extraction intentionally reads all posted `out_invoice`/`out_refund` history through the calculation period end, so pre-September billing still determines genuine new/repeat status.
- Draft invoices, partner creation, quotations, and sales orders are not customer billing history.

This is configuration-enforced rather than a separate global policy-start field. If management later requires an immutable system-wide guard against an Administrator creating a pre-September assignment/calculation, add an explicit policy-start validation in a separate approved change. It is not required to represent the confirmed September start in the current clean database.

## Validation results

| Validation | Result |
|---|---|
| Fresh JSON-2 connection | PASS |
| Odoo version/company/currency/Studio | PASS |
| Native model and field inspection | PASS |
| Charge-field creation and readback | PASS |
| Commission account inspection | PASS |
| First `studio:provision` | PASS |
| Second idempotent `studio:provision` | PASS; zero changes |
| `studio:inspect` | PASS; ready, no mismatches |
| Repository/extraction read | PASS |
| Protected application reads | PASS; all tested routes returned 200 |
| Application logout | PASS |
| Human credential login | NOT RUN; test credential environment variables absent |
| TypeScript `tsc --noEmit` | PASS |
| ESLint | PASS |
| Automated tests | PASS; 18 files, 109 tests |
| Production build | PASS |

No Incentive business record was created by these validations.
