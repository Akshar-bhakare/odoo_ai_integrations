# Phase 4 Incentives UI

## Screens

| Route | Screen | Access |
| --- | --- | --- |
| `/incentives` | Monthly dashboard, filters, totals, and calculation creation | All Incentive roles; employees receive only their API-authorized records |
| `/incentives/calculations/[id]` | Explainable accounting, Flat/Slab, customer, adjustment, source, approval, and payment detail | Record/company scope enforced by API |
| `/incentives/unresolved` | Expense, commission, and customer-owner resolution | Reviewer, Approver, Administrator |
| `/incentives/presets` | Preset list, draft editor, validation, activation, duplication, version history | Administrator |
| `/incentives/assignments` | Effective-dated employee/preset assignments and month lookup | Administrator |

The existing Orders pages remain separate and available from the shared Incentives header. The portal home now links to both modules.

## Trust Boundary

The UI never implements the incentive formulas. Dashboard rows and detail explanations read persisted engine result snapshots returned by the protected APIs. Creating, recalculating, submitting, approving, attributing, adjusting, and paying all call the Phase 3 endpoints with the signed session and CSRF token.

Approval returns the server's newly persisted authoritative snapshot after Odoo re-fetch and pure-engine recalculation. The UI does not submit or trust totals.

## API Additions

- `GET /api/incentives/employees` supplies company/role-scoped employee choices.
- `GET /api/incentives/presets/[id]/versions` supplies version history.
- `GET /api/incentives/unresolved/customer-owners` supplies unresolved owner events.
- `POST /api/incentives/attributions/customer-owners` persists one authoritative employee resolution.
- Existing calculation detail now includes parsed immutable rules/input/result snapshots, customer names, adjustments, payments, reviewer, approver, and payment state.
- Existing unresolved expense and commission reads now include posted-source date, amount, description, and account context.

Every endpoint remains wrapped by `incentiveRoute`; the existing Odoo routes remain wrapped by `legacyOdooRouteGuard`.

## Performance

- Dashboard calculations are fetched once per view rather than one accounting extraction per employee.
- Persisted result snapshots are transformed into dashboard rows in `dashboard.worker.ts`, keeping large JSON parsing away from the main UI thread.
- No engine runs in the browser or Web Worker. Heavy authoritative extraction and calculation remain server-side.
- Calculation detail fetches its snapshot, audit sources, and employee names in parallel.

## Payment

Recording a payment creates a payment record without mutating the approved calculation. Paid amount and state (`unpaid`, `partial`, or `paid`) are derived from recorded payment rows when calculations are read, so engine, carry, input, and result snapshots remain immutable. Payment mode remains in the existing V1 notes behavior; no dedicated field is required by the current business requirements.

## Validation

UI-focused tests cover Flat display, Slab display, adjustments, preset validation, and role capabilities. Existing engine, normalization, authentication, company isolation, role authorization, and snapshot tests remain in the full suite.

Live browser verification still requires a real Odoo user password and suitable Incentive group/employee assignments. No shared Odoo API key is exposed to the browser.
