# Phase 5.5 Incentives API Verification

Date: 2026-08-22  
Environment: Sunlectric Odoo test database, application at `http://localhost:3000`

## Root Cause

The browser request was structurally valid and passed authentication, same-origin, CSRF, JSON, employee-ID, month, role, and company checks.

The first failing request was:

```text
POST /api/incentives/calculations
Body: {"employeeId":8,"month":"2026-08"}
Actor: Odoo user 2, company 1, employee 1, administrator
Status: 400
Body: {"error":"Expected exactly one effective employee assignment, found 0"}
```

The API stopped in `IncentiveApiService.prepareAuthoritative()` while resolving the employee's effective preset assignment. It did not reach preset loading, extraction, normalization, the engine, or persistence.

The browser integration selected the first alphabetically returned active employee and the current month without checking whether that employee had an effective incentive assignment. Live Studio contains only one active assignment: employee 1 for February 2099. No employee has an effective assignment for August 2026.

The dashboard now loads assignments and offers only employees whose assignment is effective on the selected month's first day. When none exist, calculation is disabled with an actionable configuration message. No business calculation rules changed.

## Endpoint Contract

### Request

```http
POST /api/incentives/calculations
Cookie: sunlectric_session=<signed HTTP-only session>
Origin: http://localhost:3000
X-CSRF-Token: <token returned by the session API>
Content-Type: application/json

{"employeeId":1,"month":"2099-02"}
```

Fields:

| Field | Type | Rule |
|---|---:|---|
| `employeeId` | positive integer | Required |
| `month` | string | Required `YYYY-MM` calendar month |

The client does not submit a preset ID, version, company, source IDs, calculation options, or business-rule overrides. The server derives all authoritative values.

### Authentication and authorization

1. Verify the signed `sunlectric_session` HTTP-only cookie.
2. Require same-origin request for writes.
3. Verify `x-csrf-token` against the signed session claim.
4. Reload the Odoo actor from `res.users`; sessions do not retain stale roles/company data.
5. Require Reviewer, Approver, or Administrator scope for draft creation.
6. Use the actor's current Odoo company; the request cannot select another company.

### Authoritative calculation resolution

1. Convert month to its first and last calendar dates.
2. Find exactly one active employee assignment effective on month start.
3. Load its active, locked preset version and validate JSON/schema/checksum.
4. Load adjustments for recalculation, if applicable.
5. Load the latest prior approved calculation state.
6. Extract Odoo accounting/customer/salary data.
7. Normalize posted accounting records.
8. Run the pure TypeScript engine.
9. Create a draft calculation, immutable input/result snapshots, and source audit records.
10. Return the calculation ID, unresolved sources, and preview result.

### Success response

The route currently returns HTTP 200:

```json
{
  "calculationId": 3,
  "unresolvedSources": [],
  "preview": {
    "employeeId": 1,
    "companyId": 1,
    "months": []
  }
}
```

The actual `preview.months` contains the complete monthly calculation. The shortened shape above is documentation-only.

## Live Verification

### Security and validation matrix

| Case | Live status | Live response/result |
|---|---:|---|
| No session | 401 | `Authentication required` |
| Missing CSRF | 403 | `Invalid CSRF token` |
| Invalid CSRF | 403 | `Invalid CSRF token` |
| Missing employee | 400 | `Employee ID must be a positive integer` |
| Invalid employee | 400 | `Employee ID must be a positive integer` |
| Missing month | 400 | `Month is required...` |
| Invalid month | 400 | `Month must use YYYY-MM format` |
| No effective assignment | 400 | `Expected exactly one effective employee assignment, found 0` |
| Duplicate draft/review | 400 | `A draft or review calculation already exists...` |
| Recalculate draft | 200 | Recalculation completed |
| Recalculate approved | 400 | `Calculation 2 cannot be recalculated from approved` |
| Calculation detail | 200 | Persisted draft returned |
| Calculation sources | 200 | 1,189 source records returned |

Inactive preset, role denial, wrong-company denial, Odoo failure, persistence failure, unresolved-source response, duplicate behavior, valid calculation, and invalid transition are also covered by automated endpoint tests. Inactive-preset and wrong-company cases were not forced against live Odoo because no safe matching fixture exists.

Missing attribution does not make draft creation fail. A successful draft returns `unresolvedSources`; approval later rejects unresolved authoritative sources. This preserves review/assignment workflow while avoiding a generic error.

### Successful authenticated request

Using the existing active QA assignment:

```text
Employee: 1
Month: 2099-02
Preset version: 1, active and locked
Status: 200
Calculation ID: 3
Revision: 2
State: draft
Salary: INR 20,000
Actual Base: INR 0
Final Incentive: INR 0
Unresolved sources: 0
Persisted source records: 1,189
Recalculation status: 200
```

This request verified the complete HTTP session/CSRF/API/service/extraction/normalization/engine/Studio persistence path. February 2099 has no monthly accounting activity, which is legal; historical customer events were still extracted and persisted.

### Real Odoo extraction and engine verification

The independent live extraction/normalization run loaded:

| Item | Count |
|---|---:|
| Accounting moves | 1,389 |
| Journal lines | 8,900 |
| Normalized source audit rows | 2,401 |
| Customer events | 1,189 |
| Unresolved commission assignments | 6 |
| Unresolved customer owners | 999 |
| Salesperson/employee mapping gaps | 77 |

The real calculation fixture for employee 4 in December 2025 produced:

| Value | Result |
|---|---:|
| Wage | INR 20,000 |
| Flat threshold | INR 120,000 |
| Net Sales | INR 15,978,462.50 |
| COGS | INR 14,331,121.35 |
| Employee expenses | INR 4,242.00 |
| Actual Base | INR 1,643,099.15 |
| Rate | 10% |
| Main/final incentive | INR 164,309.92 |
| Approval-blocking owner events | 40 |

Normalization followed the approved rules: Sales is `-balance`, COGS is `balance`, GM is Sales minus COGS, posted refunds reverse Sales/COGS once, transport/loading are deducted once, and attributed expenses/commission reduce Actual Base.

## Persistence Dependencies

Draft creation writes:

- `x_sunlectric_incentive_calculation`
- `x_sunlectric_incentive_calculation_source`
- input JSON snapshot
- result JSON snapshot
- rules/checksum and preset-version linkage
- salary provenance and calculated totals

Calculation 3 proves Studio accepted the submitted values and relations. Its persisted identity is employee 1, company 1, February 2099, preset version 1, revision 2, draft, final incentive zero.

## Automated Tests

`src/app/api/incentives/calculations/route.test.ts` covers:

1. Valid calculation
2. Missing employee
3. Invalid employee
4. Missing month
5. Invalid month
6. No preset assignment
7. Inactive preset
8. No session
9. Missing/invalid CSRF
10. Role authorization denial
11. Wrong-company denial
12. Unresolved required source response
13. Odoo failure
14. Persistence failure
15. Duplicate calculation
16. Successful recalculation
17. Invalid calculation transition

`src/lib/incentives/ui/view-model.test.ts` verifies that the dashboard offers only employees with an assignment effective at the selected month start.

## Diagnostic Runner

The reusable API runner reads server/local environment variables and never prints passwords, API keys, cookies, or CSRF tokens:

```powershell
$env:ODOO_TEST_LOGIN='test-user@example.com'
$env:ODOO_TEST_PASSWORD='test-password'
npm run phase5.5:api
```

Optional variables:

- `INCENTIVE_DEBUG_BASE_URL`
- `INCENTIVE_DEBUG_MONTH`
- `INCENTIVE_DEBUG_EMPLOYEE_ID`
- `INCENTIVE_DEBUG_VALID_WRITE=true` to enable a valid assigned write

The valid-write option is disabled by default because successful calculation requests persist drafts and source records.

## Current Blockers

1. No production employee has an effective assignment for August 2026. The UI now prevents the invalid request, but an Administrator must configure approved assignments before production-month calculations can run.
2. The only active assignment remains the Phase 2 QA assignment for employee 1 in February 2099.
3. Draft calculation 3 and its source records were intentionally created by this persistence verification.
4. Historical data still contains unresolved owner, salesperson, and commission attribution that can block approval for affected real months.
5. Generic downstream Odoo/persistence exceptions currently return HTTP 400 with their message. Authentication and authorization statuses are differentiated as 401/403.
