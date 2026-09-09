# Phase 3 Authentication and Secure Incentive API

## Existing Authentication Audit

Before Phase 3, the Next.js application had no authentication library, middleware/proxy, login flow, application user model, session, or authenticated route convention. Existing `/api/odoo/*` handlers called Odoo with one shared server API key. The Phase 2 repository had role checks, but no trusted HTTP actor could reach it.

## Selected Architecture

The smallest secure V1 architecture reuses Odoo as the identity source and does not add a second user database:

1. The user submits an Odoo login and password to `POST /api/auth/login` over HTTPS.
2. The Next.js server verifies those credentials with Odoo `/web/session/authenticate`. The password is neither stored nor placed in the application session.
3. The server creates an eight-hour, `HttpOnly`, `SameSite=Strict`, production-`Secure`, HS256-signed application cookie. Its only identity claim is the Odoo `res.users` ID; it also contains a random CSRF secret.
4. Every protected request verifies the signed cookie and re-fetches the active Odoo user through the server-only API key.
5. Every write also requires same-origin and `x-csrf-token` validation.

The browser never receives `ODOO_API_KEY`, Odoo login passwords, or authoritative calculation inputs from a client-controlled identity claim. `SESSION_SECRET`, `ODOO_API_KEY`, `ODOO_URL`, and `ODOO_DATABASE` are server environment variables. See `.env.example`.

## Actor Resolution

The server resolves the actor on every API request as follows:

```text
signed session sub
  -> active res.users.id
  -> res.users.company_id and company_ids
  -> res.users.group_ids matched to exact Incentive group names
  -> active hr.employee where user_id = actor and company_id = current company
```

Exactly one employee match produces `employeeMapping = mapped`. Zero matches produce `missing`; multiple matches produce `ambiguous`. In both unresolved cases `employeeId` is null and the server never guesses. Request parameters can identify a target record, but never define the authenticated actor.

## Role Mapping

| Odoo group | Server role | Main permissions |
| --- | --- | --- |
| `Sunlectric Incentives / Employee` | `employee` | Read own employee, calculation, customer, and source data only |
| `Sunlectric Incentives / Reviewer` | `reviewer` | Company-scoped review, calculation, adjustments, and source attribution |
| `Sunlectric Incentives / Approver` | `approver` | Reviewer permissions plus approval |
| `Sunlectric Incentives / Administrator` | `administrator` | Presets, versions, assignments, all review/approval, and payment administration |
| `Sunlectric Incentives / Payment Recorder` | `payment_recorder` | Read calculation/source context and record payments only |

All access is additionally constrained to `res.users.company_ids`. Writes re-read the target record and validate its company, current state, and allowed transition in `StudioIncentiveRepository`.

## Authentication Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Verify Odoo credentials and create application session |
| `GET` | `/api/auth/session` | Return the currently revalidated public actor and CSRF token |
| `POST` | `/api/auth/logout` | Validate CSRF and clear the session cookie |

Login failures are rate-limited per client address and normalized login in the current server process. A shared production rate-limit store is recommended if deployment uses multiple instances.

## Protected Incentive Endpoints

| Category | Endpoints |
| --- | --- |
| Presets | `GET/POST /api/incentives/presets`; `POST /api/incentives/presets/[id]/versions`; `GET/PATCH /api/incentives/preset-versions/[id]`; `POST /api/incentives/preset-versions/[id]/activate` |
| Assignments | `GET/POST /api/incentives/assignments`; `PATCH /api/incentives/assignments/[id]` |
| Employee/customer reads | `GET /api/incentives/employees/[id]`; `GET /api/incentives/customer-data` |
| Calculations | `GET/POST /api/incentives/calculations`; `GET /api/incentives/calculations/[id]`; `POST .../[id]/recalculate`; `POST .../[id]/submit`; `POST .../[id]/approve` |
| Audit and adjustments | `GET .../calculations/[id]/sources`; `POST .../[id]/adjustments` |
| Attribution | `POST /api/incentives/attributions/expenses`; `POST /api/incentives/attributions/commissions`; `POST /api/incentives/attributions/customer-owners` |
| Unresolved work | `GET /api/incentives/unresolved/expenses`; `GET /api/incentives/unresolved/commissions`; `GET /api/incentives/unresolved/customer-owners` |
| Payments | `POST /api/incentives/calculations/[id]/payments` |

The pre-existing `/api/odoo/*` handlers are no longer anonymous. They require a live authenticated Odoo actor; `/api/odoo/debug` additionally requires Administrator. Authenticated attachment responses are private and not stored in shared caches.

## Approval Trust Boundary

The approval request accepts a calculation ID, not client totals. The server then:

1. authenticates and revalidates the Odoo actor;
2. confirms Approver or Administrator role and target company;
3. reads the calculation and requires Review state;
4. freshly fetches posted accounting, salary history, customer history, assignments, adjustments, and unresolved attribution;
5. resolves the one effective locked preset version and employee assignment;
6. rejects any unresolved source or changed preset assignment;
7. runs the pure TypeScript engine;
8. verifies calculation integrity and persists immutable input, result, rules, source, checksum, and engine-version snapshots.

Corrections create a new revision. Previously approved snapshots are never edited.

## Security Tests

Automated tests cover signed/tampered sessions, missing authentication, missing CSRF, Odoo role and employee mapping, own-versus-other employee visibility, company isolation, reviewer review access, approver approval, payment recording, and rejection of unauthorized approval, preset, assignment, expense-attribution, and adjustment actions.

## Remaining Deployment Blockers

- Assign real Odoo users to the five Incentive groups and verify each user's allowed companies.
- Ensure each portal user can authenticate with an Odoo password. If production users are SSO-only and have no usable Odoo password, replace only the login verifier with the company's SSO/OIDC integration; actor and authorization resolution remain unchanged.
- A successful production login cannot be end-to-end tested without a real user's Odoo password. Invalid-credential behavior and all downstream session/authorization behavior are automated and verified.
- Use a shared rate-limit backend before horizontally scaling the Next.js deployment.

No Incentives dashboard or business UI is included in Phase 3. The only frontend addition is the login/session flow.
