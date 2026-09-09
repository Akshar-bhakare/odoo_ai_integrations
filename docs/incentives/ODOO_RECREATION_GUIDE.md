# Odoo Online 19 Incentive Recreation Guide

## 1. Purpose and scope

This document is the rebuild specification for recreating the Sunlectric Incentive system in a new **Odoo Online 19 + Studio** database.

The current test database is disposable. Do not export or migrate its incentive records, QA calculations, test payments, temporary assignments, test presets, employee/customer test data, or historical test attributions.

The application-side canonical custom schema is `src/lib/incentives/odoo/studio-schema.ts`. If this document and that file disagree, stop setup and reconcile the difference before creating records. Do not invent additional model or field names.

This task does not change incentive calculations. All rates, thresholds, carry behavior, customer rules, repeat rules, accounting rules, and salary policies remain configuration or existing engine behavior.

## 2. Recreation capability summary

The current application can **partially automate** the Odoo recreation.

### Automatically supported now

With a sufficiently privileged Odoo API user and an explicit confirmation flag, `npm run studio:provision` can:

- create the 10 missing custom `x_` models;
- create their missing fields from the canonical schema;
- reject incompatible existing field definitions rather than silently changing them;
- create the five named Incentive groups;
- configure group implications;
- create or update the declared ACLs;
- create the currently declared record rules when a rule with the same name does not already exist; and
- add the JSON-2 integration user to the Incentive Administrator group.

`npm run studio:inspect` safely compares the live models and fields with the canonical application schema without provisioning them.

### Not automatically supported

The current provisioner does **not** create or fully enforce:

- Odoo company, country, currency, accounting chart, journals, taxes, or fiscal configuration;
- required Odoo applications or native records;
- the commission account with code `211810`;
- `account.move.x_studio_transport_charges`;
- `account.move.x_studio_loading_charges`;
- employees, users, employee/user links, wages, salary versions, customers, customer owners, or accounting history;
- menus, actions, list/form/search views, or polished Studio user interfaces for the custom models;
- database-level uniqueness constraints for the business keys listed below;
- complete Odoo record-rule-based multi-company isolation for all custom models;
- initial preset, preset version, employee assignments, attribution decisions, calculations, adjustments, or payments as part of schema provisioning; or
- migration of any data from the expiring database.

The application can create and manage presets, versions, assignments, attributions, calculations, adjustments, approvals, and payments **after** the schema and security foundation exists. This is application functionality, not schema provisioning.

### Odoo Online limitation

Odoo Online does not permit deployment of a custom Python module or database SQL constraints. The application therefore uses Studio `x_` models plus server-side TypeScript validation. Where Studio supports an equivalent constraint, configure it. Otherwise, the application check is authoritative but cannot provide the same concurrency guarantee as a database unique constraint.

## 3. Custom Studio model conventions

Unless a field row says otherwise:

- fields are writable and copied on duplication;
- no Odoo field default is declared by `studio-schema.ts`;
- defaults shown as **App default** are values supplied by application workflows, not model metadata;
- `x_company_id` is required, indexed, relates to `res.company`, and uses `ondelete=restrict`;
- `x_currency_id` is required, relates to `res.currency`, and uses `ondelete=restrict`;
- monetary fields use `x_currency_id` as their currency field;
- relation names below are the required forward `many2one` relations;
- the canonical schema does not require custom inverse `one2many` fields;
- Odoo-generated fields such as `id`, `create_uid`, and `create_date` are available automatically and are read by the application for identity/audit display; they are not additional Studio fields;
- fields marked indexed are created with the schema's index/search requirement, although the current inspector does not verify indexes;
- fields marked not copied protect immutable/audit snapshot data from normal duplication; and
- immutable behavior is enforced by the application and the record rules described in section 5.

## 4. The 10 required Incentive Studio models

### 4.1 Incentive Preset

- **Technical model:** `x_sunlectric_incentive_preset`
- **Display name:** Sunlectric Incentive Preset
- **Purpose:** Stable preset identity and pointer to its current version.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed; display name |
| `x_code` | Char | Yes | — | Indexed; unique per company by application validation |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed; company owner |
| `x_active` | Boolean | Yes | — | App default `true` |
| `x_current_version_id` | Many2one | No | `x_sunlectric_incentive_preset_version`; set null | Current activated version |

Validation: `x_code` must be unique inside a company. A current version must belong to the preset and company.

### 4.2 Incentive Preset Version

- **Technical model:** `x_sunlectric_incentive_preset_version`
- **Display name:** Sunlectric Incentive Preset Version
- **Purpose:** Versioned, checksummed, immutable calculation rules.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_preset_id` | Many2one | Yes | `x_sunlectric_incentive_preset`; cascade | Indexed; parent preset |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_version_number` | Integer | Yes | — | Unique per preset by application validation |
| `x_status` | Selection | Yes | `draft`, `active`, `retired` | App default `draft` |
| `x_schema_version` | Char | Yes | — | Preset JSON schema version |
| `x_rules_json` | Text | Yes | — | Canonical rules JSON; not copied |
| `x_rules_checksum` | Char | Yes | — | Indexed; not copied |
| `x_locked` | Boolean | Yes | — | App default `false`; set `true` on activation; not copied |
| `x_activated_by_id` | Many2one | No | `res.users`; set null | Audit actor; not copied |
| `x_activated_at` | Datetime | No | — | Activation timestamp; not copied |

Validation: rules JSON must satisfy `docs/incentives/preset.schema.json` and business validation. Rules are canonicalized and checksummed. Activation changes a draft to active, locks it, and makes it immutable. Do not edit locked versions; create a new version.

### 4.3 Employee Assignment

- **Technical model:** `x_sunlectric_incentive_assignment`
- **Display name:** Sunlectric Incentive Employee Assignment
- **Purpose:** Effective-dated assignment of one active preset version to an employee.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_employee_id` | Many2one | Yes | `hr.employee`; restrict | Indexed |
| `x_preset_version_id` | Many2one | Yes | `x_sunlectric_incentive_preset_version`; restrict | Must reference an active locked version |
| `x_date_from` | Date | Yes | — | Indexed; inclusive |
| `x_date_to` | Date | No | — | Indexed; inclusive when present |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_active` | Boolean | Yes | — | App default `true` |

Validation: employee, company, and preset version company must match. Active effective ranges must not overlap for the same employee/company.

### 4.4 Expense Attribution

- **Technical model:** `x_sunlectric_incentive_expense_assignment`
- **Display name:** Sunlectric Incentive Expense Attribution
- **Purpose:** Resolve an employee expense journal entry to exactly one incentive employee without changing accounting ownership.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_move_id` | Many2one | Yes | `account.move`; restrict | Indexed; posted move only |
| `x_employee_id` | Many2one | No | `hr.employee`; restrict | Empty while unresolved |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_currency_id` | Many2one | Yes | `res.currency`; restrict | Currency for attributed amount |
| `x_attributed_amount` | Monetary | No | Currency: `x_currency_id` | Optional explicit amount |
| `x_status` | Selection | Yes | `unresolved`, `assigned`, `void` | Assignment workflow uses `assigned` |
| `x_reason` | Text | Yes | — | Required business reason |
| `x_notes` | Text | No | — | Optional notes |

Validation: source move must be posted. There may be exactly one active, non-void attribution for a move. Assigned employees must belong to the same company. Splitting across employees is not supported.

### 4.5 Commission Attribution

- **Technical model:** `x_sunlectric_incentive_commission_assignment`
- **Display name:** Sunlectric Incentive Commission Attribution
- **Purpose:** Resolve an account `211810` commission journal line to exactly one incentive employee.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_move_line_id` | Many2one | Yes | `account.move.line`; restrict | Indexed; posted line on account `211810` |
| `x_employee_id` | Many2one | No | `hr.employee`; restrict | Empty while unresolved |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_currency_id` | Many2one | Yes | `res.currency`; restrict | Currency for attributed amount |
| `x_attributed_amount` | Monetary | No | Currency: `x_currency_id` | Optional explicit amount |
| `x_status` | Selection | Yes | `unresolved`, `assigned`, `void` | Assignment workflow uses `assigned` |
| `x_reason` | Text | Yes | — | Required business reason |
| `x_notes` | Text | No | — | Optional notes |

Validation: source line must be posted and use account code `211810`. Exactly one active, non-void attribution is allowed per line. Assigned employees must belong to the same company. Do not guess or split unattributed commission.

### 4.6 Customer Owner Resolution

- **Technical model:** `x_sunlectric_incentive_owner_resolution`
- **Display name:** Sunlectric Incentive Owner Resolution
- **Purpose:** Authorized manual resolution when historical customer ownership cannot be proven from Odoo history.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_event_key` | Char | Yes | — | Indexed; unique active resolution key by application logic |
| `x_employee_id` | Many2one | Yes | `hr.employee`; restrict | Resolved incentive owner |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_status` | Selection | Yes | `assigned`, `void` | Active resolution uses `assigned` |
| `x_reason` | Text | Yes | — | Required business reason |
| `x_notes` | Text | No | — | Optional notes |

Validation: exactly one active, non-void resolution is allowed per event key. Employee company must match. This does not rewrite customer ownership in Odoo.

### 4.7 Incentive Adjustment

- **Technical model:** `x_sunlectric_incentive_adjustment`
- **Display name:** Sunlectric Incentive Adjustment
- **Purpose:** Audited manual addition or deduction before approval.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_calculation_id` | Many2one | Yes | `x_sunlectric_incentive_calculation`; restrict | Indexed |
| `x_employee_id` | Many2one | Yes | `hr.employee`; restrict | Must match calculation |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_currency_id` | Many2one | Yes | `res.currency`; restrict | Currency for amount |
| `x_month` | Date | Yes | — | Indexed; calendar month key |
| `x_operation` | Selection | Yes | `add`, `deduct` | Signed effect derives from operation |
| `x_amount` | Monetary | Yes | Currency: `x_currency_id` | Must be greater than zero |
| `x_reason` | Text | Yes | — | Required business reason |
| `x_notes` | Text | No | — | Optional notes |

Validation: adjustments are allowed only while the calculation is in draft or review. Approved/superseded calculation adjustments are immutable.

### 4.8 Incentive Calculation

- **Technical model:** `x_sunlectric_incentive_calculation`
- **Display name:** Sunlectric Incentive Calculation
- **Purpose:** Revisioned calculation header, immutable snapshots, workflow, carry state, totals, and payment state.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_employee_id` | Many2one | Yes | `hr.employee`; restrict | Indexed |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_currency_id` | Many2one | Yes | `res.currency`; restrict | Calculation currency |
| `x_month` | Date | Yes | — | Indexed; first day of month |
| `x_period_start` | Date | Yes | — | Inclusive period start |
| `x_period_end` | Date | Yes | — | Inclusive period end |
| `x_preset_version_id` | Many2one | Yes | `x_sunlectric_incentive_preset_version`; restrict | Active locked version |
| `x_revision` | Integer | Yes | — | Unique per employee/month by application validation |
| `x_supersedes_id` | Many2one | No | `x_sunlectric_incentive_calculation`; restrict | Previous revision when applicable |
| `x_state` | Selection | Yes | `draft`, `review`, `approved`, `rejected`, `superseded` | App default `draft` |
| `x_engine_version` | Char | Yes | — | Pure engine version |
| `x_rules_checksum` | Char | Yes | — | Not copied; must match active version |
| `x_input_checksum` | Char | Yes | — | Not copied; identifies normalized input |
| `x_rules_snapshot_json` | Text | Yes | — | Immutable rules snapshot; not copied |
| `x_input_snapshot_json` | Text | Yes | — | Immutable normalized input; not copied |
| `x_result_snapshot_json` | Text | Yes | — | Immutable engine result; not copied |
| `x_threshold_state_json` | Text | Yes | — | Threshold decision/state snapshot; not copied |
| `x_slab_state_json` | Text | Yes | — | Slab decision/state snapshot; not copied |
| `x_carry_state_json` | Text | Yes | — | Carry and unpaid-base state; not copied |
| `x_salary_version_id` | Many2one | No | `hr.version`; restrict | Effective source record when available |
| `x_salary_source_key` | Char | Yes | — | Stable salary source reference |
| `x_salary_used` | Monetary | Yes | Currency: `x_currency_id` | First-day-of-month wage |
| `x_carry_in` | Monetary | Yes | Currency: `x_currency_id` | Prior approved state |
| `x_carry_out` | Monetary | Yes | Currency: `x_currency_id` | State for next month |
| `x_unpaid_base_in` | Monetary | Yes | Currency: `x_currency_id` | Prior unpaid eligible base |
| `x_unpaid_base_out` | Monetary | Yes | Currency: `x_currency_id` | Unpaid base for next month |
| `x_actual_base` | Monetary | Yes | Currency: `x_currency_id` | Normalized period result |
| `x_raw_incentive` | Monetary | Yes | Currency: `x_currency_id` | Engine incentive before adjustments |
| `x_adjustment_total` | Monetary | Yes | Currency: `x_currency_id` | Net manual adjustment |
| `x_final_incentive` | Monetary | Yes | Currency: `x_currency_id` | Final approved amount |
| `x_reviewed_by_id` | Many2one | No | `res.users`; set null | Reviewer audit |
| `x_reviewed_at` | Datetime | No | — | Reviewer timestamp |
| `x_approved_by_id` | Many2one | No | `res.users`; set null | Approver audit; not copied |
| `x_approved_at` | Datetime | No | — | Approval timestamp; not copied |
| `x_payment_state` | Selection | Yes | `unpaid`, `partial`, `paid` | App default `unpaid` |
| `x_paid_amount` | Monetary | Yes | Currency: `x_currency_id` | App default `0` |
| `x_review_notes` | Text | No | — | Optional review notes |

Validation: preset version must be active, locked, company-matched, and checksum-matched. Employee/month/revision must be unique. Approval performs a fresh server-side extraction and recalculation with the same TypeScript engine; unresolved inputs block approval. Approved and superseded calculations and their snapshots are immutable. Corrections use a revision rather than editing an approved calculation.

### 4.9 Calculation Source Audit

- **Technical model:** `x_sunlectric_incentive_calculation_source`
- **Display name:** Sunlectric Incentive Calculation Source
- **Purpose:** Trace each normalized calculation amount to an immutable Odoo source record/event.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_calculation_id` | Many2one | Yes | `x_sunlectric_incentive_calculation`; cascade | Indexed; parent calculation |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_currency_id` | Many2one | Yes | `res.currency`; restrict | Source amount currency |
| `x_source_model` | Char | Yes | — | Indexed; native/custom model name |
| `x_source_record_id` | Integer | Yes | — | Indexed; Odoo record ID |
| `x_source_key` | Char | Yes | — | Indexed; stable source/event key |
| `x_source_category` | Selection | Yes | See values below | Normalization category |
| `x_signed_amount` | Monetary | Yes | Currency: `x_currency_id` | Signed effect counted once |
| `x_source_snapshot_json` | Text | Yes | — | Source audit snapshot; not copied |

`x_source_category` values:

- `invoice_sales`
- `credit_note_sales`
- `cogs`
- `transport`
- `loading`
- `employee_expense`
- `commission`
- `new_customer`
- `repeat_customer`

Validation: source rows belong to one calculation and are replaced during draft recalculation. Once their calculation is approved or superseded they are immutable. Deleting a draft calculation cascades to its source rows.

### 4.10 Incentive Payment

- **Technical model:** `x_sunlectric_incentive_payment`
- **Display name:** Sunlectric Incentive Payment
- **Purpose:** Audited recording or reversal of payment against an approved calculation.

| Field | Type | Required | Relation / values | Default and behavior |
|---|---|---:|---|---|
| `x_name` | Char | Yes | — | Indexed |
| `x_calculation_id` | Many2one | Yes | `x_sunlectric_incentive_calculation`; restrict | Indexed; approved calculation only |
| `x_company_id` | Many2one | Yes | `res.company`; restrict | Indexed |
| `x_currency_id` | Many2one | Yes | `res.currency`; restrict | Payment currency |
| `x_amount` | Monetary | Yes | Currency: `x_currency_id` | Greater than zero; cannot exceed remaining amount |
| `x_payment_date` | Date | Yes | — | Business payment date |
| `x_reference` | Char | Yes | — | External/payment reference |
| `x_status` | Selection | Yes | `recorded`, `reversed` | App default `recorded` |
| `x_recorded_by_id` | Many2one | Yes | `res.users`; restrict | Audit actor |
| `x_recorded_at` | Datetime | Yes | — | Audit timestamp |
| `x_notes` | Text | No | — | Optional notes |

Validation: payments may be recorded only against approved calculations. Amount must be positive and cannot exceed the current unpaid amount. Payment totals update calculation `x_paid_amount` and `x_payment_state`.

## 5. Security recreation

### 5.1 Group identities and inheritance

These groups are currently identified by exact names because Studio/JSON-2-created records do not have module XML IDs:

| Exact group name | Intended role | Implied group |
|---|---|---|
| `Sunlectric Incentives / Employee` | Read only the signed-in employee's permitted incentive records | None |
| `Sunlectric Incentives / Reviewer` | Resolve attribution, adjust, review, and read calculation data | None |
| `Sunlectric Incentives / Approver` | Reviewer permissions plus approval | Reviewer |
| `Sunlectric Incentives / Administrator` | Full custom-model administration | Approver and Payment Recorder |
| `Sunlectric Incentives / Payment Recorder` | Read approved calculation context and record payments | None |

Administrator does not imply Employee. Add Employee separately if an administrator must use employee self-service views.

The web application also enforces action authorization:

- preset and assignment administration: Administrator;
- expense, commission, and owner resolution; adjustments; review: Reviewer, Approver, or Administrator;
- approval: Approver or Administrator;
- payment recording: Payment Recorder or Administrator.

### 5.2 ACL matrix

`R`, `W`, `C`, and `D` mean read, write, create, and delete/unlink.

| Model | Employee | Reviewer | Approver | Administrator | Payment Recorder |
|---|---|---|---|---|---|
| Preset | R | R | inherited R | RWCD | — |
| Preset Version | R | R | inherited R | RWCD | — |
| Employee Assignment | R | R | inherited R | RWCD | — |
| Expense Attribution | — | RWCD | inherited RWCD | RWCD | — |
| Commission Attribution | — | RWCD | inherited RWCD | RWCD | — |
| Owner Resolution | — | RWCD | inherited RWCD | RWCD | — |
| Adjustment | — | RWCD | inherited RWCD | RWCD | — |
| Calculation | R | R | inherited R | RWCD | R |
| Calculation Source Audit | R | R | inherited R | RWCD | R |
| Payment | R | R | inherited R | RWCD | RWCD |

The integration user used by the server is assigned Administrator by the provisioner. Browser users never receive the API key. The server authenticates the human actor and re-applies the action-role checks before using the integration user for writes.

### 5.3 Required record rules

The current provisioner declares these operation-scoped rules:

| Rule | Model | Domain | Operations | Purpose |
|---|---|---|---|---|
| Locked preset versions are immutable | Preset Version | `[('x_locked', '=', False)]` | Write, delete | Prevent edits/deletion after activation |
| Approved calculations are immutable | Calculation | `[('x_state', 'not in', ['approved', 'superseded'])]` | Write, delete | Protect approved revisions and snapshots |
| Approved adjustments are immutable | Adjustment | `[('x_calculation_id.x_state', 'not in', ['approved', 'superseded'])]` | Create, write, delete | Freeze adjustment set with approval |
| Approved source audits are immutable | Calculation Source Audit | `[('x_calculation_id.x_state', 'not in', ['approved', 'superseded'])]` | Create, write, delete | Freeze source audit with approval |
| Payments require approved calculations | Payment | `[('x_calculation_id.x_state', '=', 'approved')]` | Create, write | Limit payments to approved calculations |
| Employee: own assignments | Employee Assignment | `[('x_employee_id.user_id', '=', user.id)]` | Read | Employee self-service scope |
| Employee: own calculations | Calculation | `[('x_employee_id.user_id', '=', user.id)]` | Read | Employee self-service scope |
| Employee: own sources | Calculation Source Audit | `[('x_calculation_id.x_employee_id.user_id', '=', user.id)]` | Read | Employee self-service scope |
| Employee: own payments | Payment | `[('x_calculation_id.x_employee_id.user_id', '=', user.id)]` | Read | Employee self-service scope |

The four employee rules apply only to the Employee group. The immutability/payment rules are global operation rules.

### 5.4 Security controls requiring manual verification

The current provisioner does not create complete company-scoped record rules. On a fresh database, add and verify an appropriate `x_company_id in company_ids` rule for every custom model, including relation-based checks where needed. Do not rely solely on UI filters. The application validates company boundaries, but defense in depth requires Odoo record rules too.

The provisioner skips an existing record rule with the same name rather than updating its domain. Inspect rule definitions after every provision run.

Where supported by Studio, add uniqueness constraints for these business keys:

- Preset: company + code.
- Preset Version: preset + version number.
- Employee Assignment: no overlapping active employee/company date ranges; this is normally application validation rather than a simple unique key.
- Expense Attribution: one active non-void record per move.
- Commission Attribution: one active non-void record per move line.
- Owner Resolution: one active non-void record per event key.
- Calculation: employee + month + revision.
- Calculation Source: calculation + source key/category where the application expects uniqueness.
- Payment: reference/idempotency policy must be operationally controlled; current application validation checks amount but has no database transaction-level idempotency guarantee.

## 6. Required native Odoo applications, models, and fields

### 6.1 Required applications

Install and configure at least:

- Accounting;
- Employees;
- Expenses;
- Contacts;
- Discuss/mail tracking infrastructure; and
- Studio.

Sales may be required by the wider application Orders area, but the Incentive extraction does not currently read `sale.order` or `sale.order.line`.

### 6.2 Authentication and company context

| Model | Required fields / behavior |
|---|---|
| `res.users` | `id`, `name`, `login`, `active`, `company_id`, `company_ids`, `group_ids` |
| `res.groups` | `id`, `name`, group implications, user membership |
| `res.company` | `id`, `currency_id`; active company context must match request |
| `res.currency` | Currency records referenced by company and custom monetary fields |

The interactive login uses Odoo `/web/session/authenticate`. Server-to-Odoo data access uses JSON-2 with a server-held API key.

### 6.3 Employees and salary

| Model | Required fields / behavior |
|---|---|
| `hr.employee` | `id`, `name`, `company_id`, `user_id`, `active`, `wage` |
| `hr.version` | `id`, `company_id`, `employee_id`, `date_version`, `wage` |

For every incentive employee:

- create one active `hr.employee` in the correct company;
- link `hr.employee.user_id` to exactly the intended Odoo user;
- populate `hr.employee.wage`;
- ensure the user has the required Incentive group membership; and
- provide an effective salary history in `hr.version` for every month that may be calculated.

V1 uses the salary version effective on the **first day of the calendar month**, with no intra-month proration.

Important implementation dependency: the live extraction currently resolves calculation salary history from `hr.version`. Although `hr.employee.wage` is required and inspected, a fresh employee should also have at least one corresponding effective `hr.version` row before calculations. A missing effective salary version must be treated as a setup/data problem, not replaced by a hard-coded wage.

### 6.4 Customers and ownership

| Model | Required fields / behavior |
|---|---|
| `res.partner` | `id`, `name`, `commercial_partner_id`, `user_id` |
| `res.users` | Owner user record mapped to an employee through `hr.employee.user_id` |

The authoritative customer incentive owner is resolved as:

`res.partner.commercial_partner_id → res.partner.user_id → res.users → hr.employee.user_id`

Set the owner on the commercial customer. Do not use invoice salesperson as an automatic fallback for new/repeat customer incentives. Missing or ambiguous ownership remains unresolved until an authorized user records an Owner Resolution.

### 6.5 Historical customer owner source

| Model | Required fields / behavior |
|---|---|
| `ir.model.fields` | `id`, `model`, `name`; locate the `res.partner.user_id` field metadata |
| `mail.tracking.value` | `id`, `field_id`, `mail_message_id`, `old_value_integer`, `new_value_integer`, `create_date`; owner changes |
| `mail.message` | `id`, `model`, `res_id`, `date`; partner and effective timestamp linkage |

Enable and preserve tracking/chatter for `res.partner.user_id` from the start of the new database. Historical ownership uses the owner effective at the incentive-event date. A same-day change uses the owner effective at the start of the local calendar day. If history does not prove an owner, the application must not guess.

### 6.6 Accounting documents and journal lines

| Model | Required fields / behavior |
|---|---|
| `account.move` | `id`, `name`, `date`, `state`, `move_type`, `company_id`, `commercial_partner_id`, `invoice_user_id`, `reversed_entry_id`, `x_studio_transport_charges`, `x_studio_loading_charges` |
| `account.move.line` | `id`, `move_id`, `date`, `parent_state`, `company_id`, `account_id`, `balance`, `debit`, `credit`, `expense_id` |
| `account.account` | `id`, `code`, `name`, `account_type`, `company_ids` |

Accounting extraction rules:

- only posted records count: `account.move.state = posted` and journal lines with `parent_state = posted`;
- customer documents are `move_type in (out_invoice, out_refund)`;
- customer-history extraction reads all posted customer invoices/refunds through the requested period end, not only the calculation month;
- Sales lines use account type `income` and normalized Sales is `-balance`;
- COGS lines use account type `expense_direct_cost` and normalized COGS is `balance`;
- posted credit-note/refund lines naturally reverse Sales and COGS through their signed balances and are counted once;
- `reversed_entry_id` is retained for audit/context, not used to apply an extra credit-note deduction;
- main Sales, COGS, transport, and loading employee attribution uses `account.move.invoice_user_id → res.users → hr.employee.user_id`;
- invoice salesperson is not a fallback for customer-owner bonuses; and
- the Incentive runtime currently has no `sale.order`/`sale.order.line` dependency.

### 6.7 Transport and loading Studio fields

Create these fields manually on `account.move` with the **exact** technical names:

| Field | Expected use | Required setup |
|---|---|---|
| `x_studio_transport_charges` | Deduction from gross margin when configured | Numeric/monetary charge, available to JSON-2 integration user |
| `x_studio_loading_charges` | Deduction from gross margin when configured | Numeric/monetary charge, available to JSON-2 integration user |

Confirm their field type and currency semantics in the fresh database. The extraction treats empty/false as zero and expects numeric values. Do not rename them without also creating a new preset version and updating the approved configuration path.

### 6.8 Employee expenses

| Model | Required fields / behavior |
|---|---|
| `hr.expense` | `id`, `employee_id`, `date`, `state` |
| `account.move.line` | `expense_id`, `parent_state`, `account_id`, `balance`, `company_id`, `date` |

Posted journal lines linked by `account.move.line.expense_id` are the accounting source. Expense account types are `expense` and `expense_direct_cost`, excluding account code `211810`, which is handled as commission. Native `hr.expense.employee_id` is authoritative when it yields exactly one employee. Otherwise, use one Expense Attribution record; never split or guess.

### 6.9 Commission

Create or confirm the company account with exact code `211810`. Posted `account.move.line` records on that account are commission expense sources. Commission reduces Actual Base and must be attributed to exactly one employee by authoritative Odoo data or one Commission Attribution. Unresolved lines block approval rather than being guessed.

### 6.10 Provisioning metadata models

The provisioning user requires access to:

- `ir.model`;
- `ir.model.fields`;
- `ir.model.access`;
- `ir.rule`;
- `res.groups`; and
- `res.users`.

This is elevated setup access. Use a dedicated integration user and review its permissions after provisioning.

## 7. Company requirements

The current environment values are:

- Company name: Sunlectric Private Limited;
- Country: India; and
- Currency: INR.

The company name and Odoo record IDs are environment-specific. Correct single-company context, an INR company currency for this deployment, and consistent company relations are application requirements.

Before incentives:

- configure the company, India localization, fiscal settings, chart of accounts, journals, and taxes;
- confirm income and direct-cost accounts have the account types used by extraction;
- create/confirm commission account `211810`;
- ensure all custom records, employees, accounting documents, presets, and assignments point to the same intended company;
- ensure the integration user's current and allowed companies include that company; and
- create the two required `account.move` Studio charge fields.

## 8. Initial standard preset

Create the first preset only after models/security and company dependencies pass inspection. Use the application preset workflow so JSON is validated, canonicalized, checksummed, versioned, activated, and locked.

Canonical source: `docs/incentives/initial-standard-preset.json`.

Required initial values:

- Name: Sunlectric Standard Sales Incentive
- Code: `SUNLECTRIC_STANDARD_SALES`
- Structure: Flat
- Threshold: salary multiple `6`
- Carry: enabled
- Main rate: `10%`
- Payout basis: entire eligible base
- Previous unpaid base: included
- Salary: version effective on first calendar day; no proration
- New customer: enabled
- New-customer qualification scope: company-global customer history
- Minimum qualifying customers: `3` per employee per month
- Minimum billing: strictly greater than ₹100,000
- Minimum GM percentage: `3.5%`
- New-customer bonus: ₹2,000 per qualifying customer
- New-customer owner: customer owner effective at event date/start of local day
- Repeat: enabled
- Repeat customer must first be a globally qualifying new customer
- Repeat window: `repeatWindowDays = 90`
- Repeat bonus: ₹2,000 per qualifying customer
- Maximum repeat payouts per customer: `1`
- Repeat owner: customer owner effective at event date/start of local day
- Performance notice: enabled after 4 consecutive failed months

These values belong in the preset/version JSON. They are not engine constants. Future rule changes require a new preset version and effective employee assignments; do not edit an activated version.

## 9. Exact fresh-instance setup order

1. **Create the Odoo Online 19 database.** Configure the intended company, India, INR, timezone, and allowed companies.
2. **Install required applications.** Accounting, Employees, Expenses, Contacts, Discuss/mail, and Studio; install Sales if the wider Orders UI needs it.
3. **Configure accounting.** Complete localization, chart, journals, taxes, income/direct-cost account types, and account `211810`.
4. **Create native Studio charge fields.** Add exact `account.move` fields `x_studio_transport_charges` and `x_studio_loading_charges`; grant integration-user read access.
5. **Create users and employees.** Link each `hr.employee.user_id`, company, active status, and current `wage` correctly.
6. **Create salary history.** Ensure effective `hr.version` rows exist for every employee/month to be calculated.
7. **Create customers and owners.** Set the commercial partner owner and enable/preserve `res.partner.user_id` history tracking.
8. **Create a dedicated integration user and API key.** Give temporary setup access needed for metadata provisioning and native reads.
9. **Configure server environment variables.** Keep secrets server-side; never use `NEXT_PUBLIC_` for credentials.
10. **Run schema inspection.** Use `npm run studio:inspect` and review missing/mismatched fields.
11. **Run confirmed schema provisioning.** Set the one-time confirmation variable and run `npm run studio:provision`.
12. **Re-run schema inspection.** Require all 10 models and canonical fields to match.
13. **Complete manual Studio/security setup.** Add/verify company record rules, business uniqueness controls, menus/actions/views if wanted, and inspect every generated ACL/rule domain.
14. **Assign human roles.** Add users to Employee, Reviewer, Approver, Administrator, and/or Payment Recorder as approved. Keep least privilege.
15. **Verify native extraction dependencies.** Check account fields, salary versions, employee mappings, customer owners/history, expense links, commission account, and posted accounting signs.
16. **Create the standard preset.** Use the canonical JSON, create version 1, validate, activate, and lock it.
17. **Create employee assignments.** Choose approved effective dates and avoid overlaps.
18. **Run connection/API checks.** Verify web session authentication, JSON-2 reads, correct company context, and server-only credentials.
19. **Run a controlled calculation workflow.** Use disposable records in the new test database; verify draft, sources, review, server recalculation, approval, adjustment, and payment.
20. **Run the full readiness suite.** Complete the checklist in section 13 before business UAT or production use.

Do not run the destructive Studio smoke/workflow scripts against production data without explicit approval and a disposable test scope.

## 10. Environment variables and secret handling

### Runtime server variables

| Variable | Classification | Purpose |
|---|---|---|
| `ODOO_URL` | Safe configuration | Odoo base URL; server-side is preferred |
| `ODOO_DATABASE` | Sensitive configuration | Odoo database identifier used by web authentication |
| `ODOO_API_KEY` | Secret | JSON-2 bearer credential for the integration user |
| `SESSION_SECRET` | Secret | Application session signing secret; at least 32 characters |
| `NODE_ENV` | Safe configuration | Runtime mode |

### One-time provisioning/test controls

| Variable | Classification | Purpose |
|---|---|---|
| `SUNLECTRIC_STUDIO_PROVISION` | Safe confirmation | Must equal `CONFIRM` before provisioning writes |
| `SUNLECTRIC_STUDIO_SMOKE` | Safe confirmation | Must equal `CONFIRM` before destructive QA smoke writes |
| `ODOO_TEST_LOGIN` | Secret/test credential | Required only by the local `phase5.5:api` diagnostic; not required by production runtime |
| `ODOO_TEST_PASSWORD` | Secret | Required only by the local `phase5.5:api` diagnostic; not required by production runtime |

### Diagnostic configuration

- `INCENTIVE_DEBUG_BASE_URL`
- `INCENTIVE_DEBUG_MONTH`
- `INCENTIVE_DEBUG_EMPLOYEE_ID`
- `INCENTIVE_DEBUG_VALID_WRITE`

Store secrets only in local ignored `.env` files or the deployment platform's encrypted server environment. Never commit actual values, return them from APIs, log them, or expose them to browser code. In particular, do not define credential variables with a `NEXT_PUBLIC_` prefix.

## 11. JSON-2 and application API expectations

### Odoo JSON-2 transport

- Base endpoint: normalized Odoo URL plus `/json/2`.
- Request: `POST /json/2/{model}/{method}`.
- Authentication: `Authorization: bearer <ODOO_API_KEY>` from server code only.
- Body: JSON method arguments and context.
- Core methods used: `search_read`, `create`, `write`, `unlink`, and `context_get`.
- Read pagination: application batches records, currently using pages of up to 500.
- Company context: API user current/allowed company must contain the requested company; application domains also include company IDs.

### Interactive authentication

- Browser submits credentials to the application server, not directly to client-side Odoo extraction code.
- Server authenticates with `/web/session/authenticate` using `ODOO_DATABASE`.
- Application stores a signed, HTTP-only session and applies CSRF protection.
- Odoo API key and password are never returned to the browser.
- Server authorizes the human actor before privileged operations, then performs JSON-2 writes with the integration identity.

### Models accessed at runtime

Native read models:

- `res.users`, `res.groups`, `res.company`, `res.currency`;
- `hr.employee`, `hr.version`, `hr.expense`;
- `res.partner`;
- `account.move`, `account.move.line`, `account.account`;
- `ir.model.fields`, `mail.tracking.value`, `mail.message`; and
- provisioning-only metadata models listed in section 6.10.

Custom models: all 10 models in section 4.

The integration user needs read permission for every native source field and the role-appropriate custom-model access. During schema provisioning it additionally needs metadata-model create/write access. Remove unnecessary elevated native configuration rights after setup if runtime calls do not need them.

## 12. Data classification

### 12.1 Required Odoo infrastructure/configuration

- Odoo Online 19 database and required applications;
- company, India/INR configuration, timezone, accounting chart/journals;
- commission account code `211810`;
- two exact transport/loading Studio fields;
- all 10 custom models and canonical fields;
- five groups, implications, ACLs, immutability rules, employee self-read rules, and manually verified company isolation rules;
- dedicated integration user/API key and server environment;
- human users and approved role memberships; and
- owner-field history tracking.

### 12.2 Optional historical/reference data

Historical records are not needed to prove that the software starts, but are required for correct retrospective business results:

- company-wide posted customer invoice/refund history needed to determine first/new and repeat qualification;
- historical `hr.version` salary rows for prior calculation months;
- historical customer owner tracking at each incentive event date; and
- prior approved incentive carry/unpaid-base state if production starts mid-scheme rather than from a clean policy boundary.

For a clean new test environment, qualification is based only on records created/imported there. Before production, management must decide the approved history cutoff/import policy. Missing owner history remains unresolved and must not be inferred.

### 12.3 Disposable test data; do not migrate

- test incentive calculations and calculation sources;
- test payments and reversals;
- test adjustments;
- temporary employee assignments;
- test presets and versions;
- QA calculation/revision chains;
- historical test expense/commission/owner attributions;
- test employees, users, customers, invoices, refunds, expenses, and commissions; and
- all other data created only for the expiring test instance.

### 12.4 Production data required before go-live

- approved production users/employees and exact `user_id` mappings;
- current wages and effective salary versions;
- approved customer/commercial-partner owners and owner history from the chosen start boundary;
- posted accounting source history required by the approved calculation periods;
- active locked production preset version and effective employee assignments;
- authorized role memberships;
- approved opening carry/unpaid-base state if applicable; and
- controlled resolutions for any genuinely unresolved expenses, commissions, or customer owners.

## 13. Fresh-instance validation checklist

### Platform and connection

- [ ] Odoo version is Online 19 and Studio is available.
- [ ] Required applications are installed.
- [ ] `ODOO_URL` reaches the new database.
- [ ] `/web/session/authenticate` succeeds with an authorized test user.
- [ ] JSON-2 `context_get` succeeds with the server-held API key.
- [ ] API context uses the intended company.
- [ ] No Odoo credentials or API keys appear in browser bundles or responses.

### Company and accounting

- [ ] Company, India, timezone, and INR are correct.
- [ ] Income and direct-cost account types match extraction assumptions.
- [ ] Commission account `211810` exists in the correct company.
- [ ] `account.move.x_studio_transport_charges` exists and is numeric/readable.
- [ ] `account.move.x_studio_loading_charges` exists and is numeric/readable.
- [ ] Posted invoice signs normalize to positive Sales and expected COGS.
- [ ] Posted credit-note signs reverse Sales and COGS exactly once.
- [ ] Posted expense lines link through `account.move.line.expense_id`.
- [ ] Posted account `211810` lines are discoverable as commission.

### Employees, salary, and customers

- [ ] Every incentive employee is active and in the correct company.
- [ ] Every incentive employee has exactly the intended `hr.employee.user_id`.
- [ ] `hr.employee.wage` is populated.
- [ ] An effective `hr.version` exists for each calculation month.
- [ ] Commercial customers resolve through `commercial_partner_id`.
- [ ] Commercial partner `user_id` resolves to one employee.
- [ ] `res.partner.user_id` tracking history is enabled and readable.
- [ ] Missing historical owners produce unresolved events, not guessed owners.

### Custom schema and security

- [ ] All 10 custom models exist with exact technical names.
- [ ] Every field and selection in section 4 matches `studio-schema.ts`.
- [ ] Monetary fields use `x_currency_id`.
- [ ] Required/index/ondelete/copy properties are manually checked where the inspector cannot verify them.
- [ ] All five exact group names exist.
- [ ] Approver implies Reviewer.
- [ ] Administrator implies Approver and Payment Recorder.
- [ ] ACL matrix matches section 5.2.
- [ ] Global immutability/payment rules match section 5.3.
- [ ] Employee own-record read rules match section 5.3.
- [ ] Company isolation rules are present and tested for every custom model.
- [ ] Existing named rules were inspected rather than assumed updated.
- [ ] Business uniqueness controls are configured or operationally acknowledged.

### Preset and workflow

- [ ] Standard preset JSON matches `initial-standard-preset.json`.
- [ ] Preset version validates, activates, locks, and has a checksum.
- [ ] Employee assignment accepts a valid effective range and rejects overlap.
- [ ] Extraction reads posted accounting and global customer history.
- [ ] Normalization attributes Sales/COGS/charges by invoice salesperson and customer bonuses by customer owner.
- [ ] Unassigned expenses, commissions, and historical owners remain unresolved.
- [ ] Draft calculation and source audit rows are created.
- [ ] Review works for an authorized reviewer.
- [ ] Approval performs a fresh server recalculation and freezes snapshots.
- [ ] Adjustment changes final incentive only while draft/review.
- [ ] Payment recording is limited to approved calculations and remaining amount.
- [ ] Employee self-service cannot read another employee's calculation.
- [ ] Cross-company reads/writes are rejected.

### Available commands

Run from the application repository with server environment configured:

```powershell
npm run studio:inspect
$env:SUNLECTRIC_STUDIO_PROVISION='CONFIRM'; npm run studio:provision
npm run studio:inspect
npm run phase5:inspect
npm run phase5:http
npm run phase5.5:api
npm run phase6:uat
npm run phase7:audit
npm test
npm run lint
npm run build
```

Use these only in a disposable test scope because they perform validation writes:

```powershell
$env:SUNLECTRIC_STUDIO_SMOKE='CONFIRM'; npm run studio:smoke
npm run phase5:workflow
```

Unset one-time confirmation/test credentials after use. Never place actual values in documentation or source control.

## 14. Known recreation/readiness considerations

These are not reasons to alter the approved business engine, but they must be considered when rebuilding:

- schema provisioning is safe-guarded but partial; native fields, data, UI configuration, complete company rules, and uniqueness controls remain manual;
- the inspector verifies core type/relation/required/readonly/ondelete/currency/selection metadata but not every index or copied flag;
- an existing named record rule is not rewritten automatically, so inspect domains and operation flags;
- current salary extraction depends on effective `hr.version` data even though `hr.employee.wage` is also required;
- historical new/repeat qualification is only as complete as the posted customer history loaded in the fresh database;
- historical customer ownership is only as complete as tracking retained from the approved start boundary;
- Odoo Studio/app checks cannot fully replace transactional database constraints, especially around concurrent uniqueness and payment idempotency; and
- destructive QA commands are verification tools, not production bootstrap or data migration tools.

## 15. Information required when the new instance is available

Provide or confirm through secure server configuration, not this document:

- new Odoo base URL and database name;
- dedicated integration user and API key;
- target company ID, currency ID, timezone, and allowed-company context;
- installed applications and whether Odoo Online permits the required JSON-2 metadata writes;
- availability and exact behavior of `hr.version`, `account.move.line.expense_id`, `commercial_partner_id`, and owner tracking in the new database;
- exact commission account code/account mapping if accounting changes from `211810`;
- confirmed type/currency behavior of the two charge fields;
- approved production employee/user/company mappings and salary-version history;
- approved customer owner assignments and historical owner-data start date;
- historical customer billing/refund import scope for new/repeat qualification;
- approved employee assignment start dates and production preset activation date;
- authorized memberships for all five Incentive groups;
- selected multi-company record-rule design and available Studio uniqueness constraints; and
- whether production begins with zero carry/unpaid base or requires an approved opening state.

No current test-instance records are required for this recreation.
