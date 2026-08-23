# ShiftProof

**Realtime photo-proof SOP compliance for retail & hospitality operations.**  
*Turn chaotic WhatsApp photo dumps into an auditable, clause-cited compliance scoreboard in under 60 seconds.*

[![Live Demo](https://img.shields.io/badge/Live%20Demo-shift--proof--phi.vercel.app-059669?style=flat-square&logo=vercel)](https://shift-proof-phi.vercel.app)
[![GitHub Repository](https://img.shields.io/badge/Repository-Anikesh--Paul%2FShiftProof-181717?style=flat-square&logo=github)](https://github.com/Anikesh-Paul/ShiftProof)
[![Hackathon](https://img.shields.io/badge/IIT%20Jammu-AI%20First%20Hackathon%202026-4f46e5?style=flat-square)](https://shift-proof-phi.vercel.app)
[![Vision AI](https://img.shields.io/badge/Vision%20AI-Google%20Gemini%20Flash-2563eb?style=flat-square&logo=google)](https://deepmind.google/technologies/gemini/)

---

## Overview & Demo Access

ShiftProof connects floor staff and operations managers through a structured, visual verification loop. Staff submit workplace photos at the start of a shift, multimodal AI inspects them against actual café Standard Operating Procedures (SOPs), and managers receive a real-time compliance scoreboard with clause citations and actionable fix tasks.

### Live Application

| Environment | URL | Track |
|:---|:---|:---|
| **Production Web App** | [shift-proof-phi.vercel.app](https://shift-proof-phi.vercel.app) | AI for Industry, Business & Productivity |

### Demo Credentials

Both operational roles can be evaluated immediately on the live app:

| Role | Email | Password | Scope & Primary Actions |
|:---|:---|:---|:---|
| **Floor Staff** | `staff@shiftproof.demo` | `DemoStaff123!` | Resume active draft, upload opening check photos, view AI findings, submit re-check photos for fixes |
| **Store Manager** | `manager@shiftproof.demo` | `DemoManager123!` | Live inbox (Today / Backlog), inspect evidence via lightbox, override AI findings, assign fix tasks, export compliance PDF |

---

## Operational Problem & The ShiftProof Solution

### The Opening-Check Dilemma
In retail kitchens, coffee shops, and campus eateries, opening checklists are critical for food safety, hygiene, and brand consistency. However:
* **Static SOPs**: Standard Operating Procedures exist inside binders or PDFs that are rarely referenced during daily shifts.
* **Unstructured Photo Dumps**: Staff post random photos into messaging group chats without context, making verification slow and disorganized.
* **Blind Operational Trust**: Managers lack the time to review hundreds of photos before rush hours begin.
* **Audit Vulnerability**: Pre-inspection audits become stressful scrambles due to the lack of an auditable compliance trail.

### The ShiftProof Approach
ShiftProof replaces unstructured messaging threads with an automated, auditable verification pipeline:
1. **Frictionless Daily Routine**: Staff take 3–8 opening check photos covering prep counters, refrigeration temps, PPE, sanitization, and date labeling.
2. **Multimodal Clause Verification**: Google Gemini Flash evaluates the evidence pool directly against active SOP clauses.
3. **Tri-State Clause Scoring**: Every checklist item is scored as **Pass**, **Gap** (non-compliance), or **Unclear** (insufficient/glared evidence) with verbatim clause quotes.
4. **Human-in-the-Loop Management**: Managers review real-time scores, agree or override findings with an audit reason, and assign one-click remediation tasks.
5. **Closed-Loop Resolution & Export**: Staff submit targeted follow-up photos to verify fixes, producing a clean, 1-page compliance pack for inspectors.

---

## System Architecture & Workflow

```
[ Floor Staff ]
      │
      │ 1. Upload 3–8 opening check photos
      ▼
[ Appwrite Storage (Evidence Pool) ]
      │
      ▼
[ Appwrite Serverless Function (runShiftScore) ]
      │
      ├─ 2. Multimodal scene understanding via Google Gemini Flash
      ├─ 3. Match visual evidence to active SOP clause set
      ▼
[ Structured Findings ]
      │ (Pass | Gap | Unclear + verbatim clause citation + confidence)
      ▼
[ Store Manager Inbox ] ── Realtime WebSocket Stream
      │
      ├─ 4. High-resolution photo inspection
      ├─ 5. Human-in-the-loop override with logged audit trail
      ├─ 6. Assign targeted remediation tasks for gaps
      ▼
[ Staff Fix & Re-check ] ── Single follow-up photo → Auto re-score
      │
      ▼
[ 1-Page Compliance Pack ] ── Export verified PDF audit document
```

---

## Core Capabilities

### 1. Structured Scoreboard (No Conversational Chatbot Fluff)
* **Operational Precision**: Fast, tabular overview prioritizing status and next actions.
* **Tri-State Finding System**:
  * `✓ PASS`: High-confidence evidence verifying that the item complies with the cited clause.
  * `✗ GAP`: Visual evidence indicating non-compliance (missing PPE, improper storage, temperature breaches).
  * `? UNCLEAR`: Insufficient visibility, blur, or glare—delegating the final decision to the manager rather than hallucinating outcomes.
* **Verbatim SOP Citations**: Every finding includes the specific clause number, exact text snippet, and evidence notes.

### 2. Honest AI & Human-in-the-Loop (HITL)
* **Audited Overrides**: Managers can correct any AI finding. Every override records the author, timestamp, and explanation in the permanent event log.
* **Dynamic SOP Clause Extraction**: Uploading a new SOP PDF automatically extracts and activates a 3–8 item photo-provable checklist.
* **Remediation & Re-Check Workflow**: Gaps trigger remediation tasks; staff capture a single follow-up photo, which is re-evaluated against the specific clause.
* **Attestation Fallback**: In the event of network or quota constraints, staff can record an honest visual attestation without halting operations.

### 3. One-Page Compliance Export
* **Audit-Ready Documentation**: Generates a single-page PDF summarizing shift outcome, checklist results, identified gaps, manager interventions, and timestamps.
* **Inspection Ready**: Formatted for quick review by health inspectors, franchise auditors, and store owners.

---

## Technology Stack

| Domain | Technology | Implementation Details |
|:---|:---|:---|
| **Frontend UI** | **React 19, TypeScript, Vite** | Mobile-responsive client with custom accessibility-first design system and photo lightbox. |
| **Backend Platform** | **Appwrite Cloud (TablesDB)** | Authentication, relational data models (sites, sops, checklists, shifts, findings, tasks, events). |
| **Media Storage** | **Appwrite Storage** | Dedicated buckets for original evidence photos, re-check photos, and SOP documents. |
| **Realtime Engine** | **Appwrite Realtime** | WebSocket event subscriptions updating the manager inbox as scores complete. |
| **Multimodal Vision AI** | **Google Gemini Flash** | Automated visual reasoning running server-side in Appwrite Functions (`runShiftScore`). |
| **Hosting & Edge** | **Vercel** | Global edge deployment for the frontend application. |

---

## Repository Structure

```text
ShiftProof/
├── web/                           # React + TypeScript web application
│   ├── src/
│   │   ├── components/            # Reusable UI components (Lightbox, Status Chips, Buttons, Shell)
│   │   ├── pages/
│   │   │   ├── staff/             # Staff portal: Draft checks, camera upload, shift review
│   │   │   └── manager/           # Manager portal: Inbox, shift detail scoreboard, PDF export
│   │   ├── lib/                   # Appwrite SDK client & API abstractions
│   │   └── types/                 # Shared frontend domain interfaces
│   └── package.json
│
├── functions/
│   └── runShiftScore/             # Serverless Appwrite Function (Node.js)
│       ├── src/                   # Gemini Flash multimodal vision engine & SOP extractors
│       ├── deploy.ps1             # Function deployment automation
│       ├── set-vars.ps1           # Environment variable provisioning
│       └── README.md
│
├── types/
│   └── shiftproof.ts              # Canonical domain contracts and data models
│
└── docs/                          # Architecture & API specifications
    ├── API.md                     # Backend API contracts & operation specifications
    ├── APPWRITE.md                # Appwrite database tables & storage bucket definitions
    ├── PERMISSIONS.md             # Role-based access control matrix
    └── FINDINGS_SCHEMA.json       # AI scoring JSON output schema
```

---

## Getting Started

### Prerequisites
* **Node.js** (v20 or higher)
* **npm** (v10 or higher)

### 1. Clone the Repository
```bash
git clone https://github.com/Anikesh-Paul/ShiftProof.git
cd ShiftProof
```

### 2. Configure & Run the Frontend
```bash
cd web
npm install
```

Set up your local environment in `web/.env`:
```env
VITE_APPWRITE_ENDPOINT=https://sgp.cloud.appwrite.io/v1
VITE_APPWRITE_PROJECT_ID=6a5b0ce3002605c7a776
```

Start the development server:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser and log in with a demo account.

---

## Backend Function Deployment (Maintainers)

The multimodal vision analysis executes server-side in an isolated Appwrite Serverless Function (`runShiftScore`).

### Required Environment Variables
Configure these variables securely in the Appwrite Console:

| Variable | Description |
|:---|:---|
| `APPWRITE_API_KEY` | Server API key with permissions for TablesDB, Storage, and Functions |
| `APPWRITE_ENDPOINT` | Regional endpoint (e.g., `https://sgp.cloud.appwrite.io/v1`) |
| `APPWRITE_PROJECT_ID` | Appwrite project identifier |
| `VERTEX_API_KEY` | Vertex / Agent Platform API key for Gemini Flash (score, extract, re-check) |
| `VERTEX_PROJECT_ID` | GCP project id (e.g. `jammu-hackathon`) |
| `VERTEX_LOCATION` | *(Optional)* Vertex location (default `global`) |
| `GEMINI_PROVIDER` | *(Optional)* `vertex` or `studio`. Auto `vertex` when `VERTEX_API_KEY` is set |
| `GOOGLE_AI_API_KEY` | Google AI Studio key — only if `GEMINI_PROVIDER=studio` |
| `GEMINI_MODEL` | *(Optional)* Ignored for scoring order |

### Deployment Commands
```powershell
# From the repository root
.\functions\runShiftScore\deploy.ps1
.\functions\runShiftScore\set-vars.ps1
```

---

## Operational & Design Principles

* **Truth First**: The gap scoreboard takes priority over cosmetic graphs. Status and actionable tasks are immediate.
* **Habitual Proof**: Staff flows remain short, obvious, and mobile-friendly so evidence capture fits naturally into pre-service routines.
* **Structured Over Conversational**: Clean classifications (Pass / Gap / Unclear) with clause citations instead of free-form chat interfaces.
* **Calm Under Pressure**: Clear visual hierarchy, accessible contrast, and explicit text labels designed for fast-paced store environments.
* **Evidence-Backed Trust**: Every assessment is grounded in tangible photos and traceable to documented SOP clauses.
