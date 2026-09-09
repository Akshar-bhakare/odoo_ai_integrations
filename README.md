# Odoo AI Integrations & ERP Portal

An enterprise-grade integration suite bridging **Odoo ERP** with modern web architectures and AI capabilities. Built with **Next.js 15 (App Router)**, **TypeScript**, and **Tailwind CSS**, this platform delivers two high-impact business systems: a speech-enabled inventory assistant (**Voice Stock**) and an audited, client/server sales incentive calculation engine (**Incentive Studio & Workbench**).

---

## Technical Stack & Architecture

### Core Technologies

| Layer | Technologies & Libraries |
|:---|:---|
| **Frontend & SSR** | Next.js 15, React 19, Tailwind CSS v4, Web Workers API |
| **Language & Runtime** | TypeScript 5 (Strict Mode), Node.js LTS |
| **AI & NLP** | OpenAI GPT-4o-mini (Structured Outputs), Web Speech API, Whisper / Transcription API |
| **ERP Backend** | Odoo 17/18 Community & Enterprise (XML-RPC, JSON-RPC, Studio Models) |
| **Validation & State** | AJV JSON Schema Validator (`draft-07`), Web Worker Compute Pipeline |
| **PDF & Financials** | `pdf-lib` (Proforma Invoice Generation), Precise Monetary Math Engine |
| **Security & Auth** | Jose (Stateless Encrypted Sessions, HttpOnly cookies), Role-Based Access Control |
| **Testing & CI** | Vitest, Custom Studio Provisioning & UAT Validation CLI Suites |

### System Integration Topology

```
+-------------------------------------------------------------------------+
|                              Browser UI                                 |
|   - Voice Stock (Web Speech / MediaRecorder)                            |
|   - Proforma GST Invoice Generator                                      |
|   - Sales Incentives Dashboard (Web Worker Recalculations)              |
+------------------------------------+------------------------------------+
                                     |
                          Encrypted HTTPS / JSON
                                     |
+------------------------------------v------------------------------------+
|                         Next.js Application Gateway                     |
|   - Role-Based Session Management (`jose`)                              |
|   - Strict Server-Only Boundaries (`server-only`)                       |
|   - Rate-Limited AI Transcription & Entity Extraction                   |
|   - Authoritative Dual-Pass Computation Engine                          |
+------------------------------------+------------------------------------+
                                     |
                             XML-RPC / JSON-RPC
                                     |
+------------------------------------v------------------------------------+
|                             Odoo ERP Core                               |
|   - Stock / Inventory (`stock.quant`, `product.template`)               |
|   - Sales & Invoicing (`sale.order`, `account.move`, `account.move.line`)|
|   - Custom Studio Models (`x_incentive_calculation`, `x_incentive_rule`)|
+-------------------------------------------------------------------------+
```

---

## Core Capabilities

### 1. Voice Stock & Copilot Assistant
- **Speech-to-Inventory:** Real-time microphone input capturing complex warehouse queries (e.g., *"Check 10 units of 40A double-pole MCB from Schneider"*).
- **Structured LLM Grounding:** Employs GPT-4o-mini with constrained JSON schemas to parse brands, product names, SKUs, and requested quantities against live inventory records.
- **Instant Availability Checking:** Direct queries against Odoo's stock quant tables for physical and reserved stock status.
- **Proforma Assistant:** One-click conversion of conversational order intents into structured, GST-compliant proforma PDF invoices.

### 2. Enterprise Sales Incentive Engine
- **Audited Computation Engine:** Dual-execution design where the exact same mathematical model runs on the client (via Web Worker for instant UI previews) and authoritatively on the server during approval.
- **Rule Flexibility:**
  - **Flat Multipliers:** Configurable salary multipliers, baseline targets, and carry-forward rules.
  - **Tiered Slabs:** Multi-tier target achievements supporting progressive and non-progressive rate brackets.
  - **Customer Margin & Commission:** Dynamic commission rates linked to gross profit margins and custom partner attributions.
- **Odoo Studio Persistence:** Approved calculations, adjustments, audit trails, and payment records are committed directly to dedicated custom Odoo models with full ledger traceability.
- **Accounting Reconciliation:** Automated extraction of `account.move.line` journal entries to reconcile incentives against recognized revenues and actual P&L.

---

## Directory Structure

```
├── docs/                       # Architecture specifications and UAT manuals
│   └── incentives/             # Engine design specs, schema schemas, and audit guides
├── public/                     # Static media and corporate assets
├── scripts/                    # CLI tools for Odoo studio provisioning & smoke tests
├── src/
│   ├── app/                    # Next.js App Router routes and API endpoints
│   │   ├── actuals/            # Accounting reconciliation and P&L actuals UI
│   │   ├── api/                # REST endpoints (auth, stock, odoo, incentives)
│   │   ├── incentives/         # Incentive calculation workbench and dashboard
│   │   ├── login/              # Enterprise authentication gateway
│   │   ├── proforma/           # GST PDF Proforma invoice generator
│   │   └── stock/              # Voice Stock inventory copilot interface
│   ├── components/             # Reusable UI component systems
│   │   ├── accounting/         # P&L and journal reconciliation tables
│   │   ├── incentives/         # Workbench, calculation drawers, and rule builders
│   │   └── stock/              # Audio visualizer and stock response cards
│   └── lib/                    # Core business logic (isolated & test-backed)
│       ├── accounting/         # Financial aggregators and attribution engines
│       ├── auth/               # Stateless session validators and RBAC gates
│       ├── customers/          # Partner resolvers and query pagination
│       ├── incentives/         # Pure TypeScript incentive calculation engine
│       ├── odoo/               # XML-RPC client and transport error boundaries
│       └── stock/              # NLP catalog grounder and speech transcript parsers
```

---

## Getting Started

### Prerequisites

- Node.js `18.18+` or `20+`
- npm, pnpm, or yarn
- Access to an Odoo instance (v17 or v18) with XML-RPC enabled

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Akshar-bhakare/odoo_ai_integrations.git
   cd odoo_ai_integrations
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env.local` and provide your credentials:
   ```bash
   cp .env.example .env.local
   ```
   Key environment variables:
   - `ODOO_URL`: Full base URL of your Odoo server.
   - `ODOO_DATABASE`: Target database name.
   - `ODOO_API_KEY`: Server-only administrative or integration user API key.
   - `SESSION_SECRET`: 32+ character random string for signing HTTP sessions.
   - `OPENAI_API_KEY`: API key for speech transcription and query extraction.

4. **Run the Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## Verification & Tooling

The repository includes a comprehensive testing and provisioning toolchain:

```bash
# Run unit tests across the calculation engine and parsers
npm test

# Run isolated tests for the incentive calculation engine
npm run test:engine

# Provision required custom Studio fields in Odoo
npm run studio:provision

# Verify live Odoo connectivity and model structures
npm run studio:inspect

# Execute end-to-end User Acceptance Testing (UAT) suite
npm run phase6:uat

# Run production audit and security boundary checks
npm run phase7:audit
```

---

## Security & Architecture Principles

- **Zero Client Credential Leakage:** Odoo credentials, tokens, and OpenAI secret keys are strictly bounded to the server environment using Next.js `server-only` conventions.
- **Server Authoritative Writes:** Client computations rendered in Web Workers are treated as advisory previews. Final approval triggers an isolated server-side recalculation before any write operation is committed to Odoo.
- **Audit Immutability:** Historical approved calculations store deep JSON snapshots preserving exact product rates, employee rules, and thresholds as they existed at the time of payout.

---

## License

Internal proprietary software. All rights reserved.
