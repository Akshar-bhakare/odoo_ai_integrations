# Genuinely Unresolved Questions

The Flat/Slab formulas, carry semantics, negative-base handling, no-split expense rule, posted-state rule, expense auto-domain, commission account, calendar-month period, salary source, repeat window, billing comparison, global customer qualification, customer-owner source, and same-day ownership rule are resolved. Only the following genuine decisions or data remediations remain.

## Authentication and Roles

1. Authentication architecture is resolved for V1: Odoo credentials create a short-lived signed Next.js session containing only the Odoo user ID, and every protected request revalidates that user, company, employee mapping, and Incentive groups from Odoo. If production users are SSO-only, the login verifier must later be replaced with the company OIDC provider without changing actor resolution.
2. Five Odoo groups define Employee, Reviewer, Approver, Administrator, and Payment Recorder permissions. The remaining data task is assigning real users to each group and verifying their allowed companies.

## Accounting Scope and Signs

3. Which explicitly identified standalone journals, if any, should affect Adjusted GM for discounts, pricing corrections, bad debts, or miscellaneous accounting adjustments? Normal posted customer invoices/refunds, COGS, transport, and loading are already resolved and must not be duplicated here.

## Required Data Resolution

4. Historical owner tracking is available, but owner data must be backfilled or manually resolved before affected customer bonuses can be approved. Of 264 first customer events, 176 have no owner at the event date and 10 resolve to a user without an employee mapping. Same-day events are not open: they use the owner effective at local start-of-day.
5. The six account `211810` lines inside the current scheme/export period need explicit employee assignments because Odoo contains no authoritative native relation. A seventh live line predates that period and needs assignment only if an earlier calculation includes it. The account and sign rule are resolved; the missing assignments are a data-readiness blocker only.

Vishal is not a blocker: he is excluded from the V1 incentive population until a real `hr.employee` exists.

## Legacy Parity Fixture

6. Provide `Invoice Charges May 2026.xlsx` only if transport/loading parity with the old Python output must be reproduced for that historical fixture. Production does not depend on this file.
