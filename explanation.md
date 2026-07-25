# ShiftProof — Simple Team Guide

> **Our chosen project** for the IIT Jammu AI First Hackathon  
> **Track:** AI for Industry, Business & Productivity  
> **What we’re building:** a website where staff upload photos and AI checks if the shop followed the rules  
> **Team score for this idea:** **8.35 / 10** (highest on our shortlist)  
> **Can we build it in time?** Yes — rated as a clear **GO**

This guide is written so **anyone on the team** can understand the project — even without a tech background.  
If you only read one file before meetings, read **this** one.

**Note:** Older notes may use hard words like “multimodal,” “clause-cited,” “HITL,” “wrapper,” or “schema.”  
This file says the **same things in plain English**.  
For the full project specification (features, stack, plan, pitch), see **`PROJECT.md`**.  
For idea-selection history, see `output/FINAL-SHORTLIST.md`.
---

## Tiny glossary (plain English)

| Word we use | What it really means |
|-------------|----------------------|
| **SOP** | “Standard Operating Procedure” — the official rule book (usually a PDF). Example: how a café should open safely. |
| **Clause** | One specific rule inside that rule book. Example: “Wear gloves when handling ready-to-eat food.” |
| **Shift check** | A quick check at the start (or end) of a work shift: take photos to prove rules were followed. |
| **Scoreboard** | A clear table of Pass / Fail / Unclear — **not** a chat box. |
| **Gap** | Something that failed or is missing (a problem that needs fixing). |
| **Audit pack** | A simple 1-page PDF report a manager can show later as proof. |
| **MVP** | “Minimum viable product” — the **smallest complete version** we must finish for the hackathon. |
| **Appwrite** | The online backend service our team is using (logins, files, data, live updates). |
| **AI / model** | The smart service that can **look at photos** and compare them to the rules. |
| **Human-in-the-loop** | When AI is unsure, a **person** (the manager) makes the final call. |

---

## 1. What is ShiftProof? (one sentence)

**Staff take photos during a shift → AI checks those photos against the café rule book → the manager sees what’s wrong → someone fixes it → we export a simple report.**

**Pitch line for the video:**  
> “WhatsApp photo compliance becomes a clear shift scoreboard your manager can trust in under a minute.”

In everyday words:  
Today people dump random photos in WhatsApp and hope the boss trusts them.  
ShiftProof turns those photos into a **clear report card** linked to real rules.

---

## 2. What problem are we solving?

### Who is this for?

Owners and managers of **small places** (about 5–50 people), especially:

- Cafés and food counters  
- Campus mess / food areas  
- Small shops that already have written rules nobody really follows  

**Important decision for the hackathon:**  
We only build for **one example:** a **café food-safety opening checklist**.  
We do **not** try to cover factories, hospitals, and every industry at once.

### What goes wrong today?

| What happens now | Why that’s a problem |
|------------------|----------------------|
| Rules sit in a PDF nobody opens | Rules exist on paper, not in real life |
| Staff send photos on **WhatsApp** as “proof” | Photos are messy, not linked to rules, hard to search later |
| Manager has to **trust** staff | “I hope they did it” is not real proof |
| Before inspections, everyone panics and cleans | There is no day-to-day record of problems |
| Big professional systems are too expensive/complex | Small businesses can’t use them |

### Why solve this now?

- Today’s AI can **look at normal phone photos** and compare them to written rules.  
- We can build a simple staff + manager website in a few days.  
- Small businesses in India care about hygiene and quality — and we don’t need a government or hospital partnership to start.

---

## 3. Why did we pick this project?

### Simple reasons

1. **It’s not just another chatbot.**  
   The product has a full loop: photos → scores → fix tasks → report.  
   Judges like this more than “chat with AI.”

2. **AI is the heart of the product.**  
   Without AI looking at photos, ShiftProof doesn’t work. That’s what “AI-first” means.

3. **Easy to show in a demo.**  
   In under a minute: messy café photo → red/green/unclear results with rule quotes.

4. **Fits our tools.**  
   Logins for staff and manager, photo storage, AI job, live manager screen — all realistic for us.

5. **We can finish it.**  
   One café example only. Clear 4-day plan. Rated **GO**.

### How it compared to our other ideas

We scored several ideas. ShiftProof came **first (8.35)**.

| Idea | Score | Simple takeaway |
|------|------:|-----------------|
| **ShiftProof** | **8.35** | Best mix of cool demo + real product + doable in time |
| CampusCarbon | 7.78 | Similar technical shape; weaker “wow” story |
| SchemePack | 7.68 | Great India impact idea, but needs a lot of carefully written scheme data |
| CaseNest | 7.45 | Easy to build, but can look like a normal task board + AI |
| Education ideas | ~7.2 | Real problems, but stage mics / crowded space make demos riskier |
| Health idea | 6.93 | Sensitive; easy to sound like medical advice by mistake |

### What makes us different?

**We are not building:**

- A chatbot that talks about rules  
- A tool that only summarizes a PDF  
- A huge factory quality system  
- An “AI that always knows everything”

**We are building:**

**Photos → clear Pass/Fail/Unclear against real rules → manager fixes issues → save a report**  
…and when AI is unsure, the **manager decides**.

### The one way this idea can fail

If our café rule book, checklist, and demo photos are **weak or fake-looking**, the whole product feels ordinary.  
**Good demo content is as important as good code.**

---

## 4. Who uses it, and what do they do?

### Two users

| Person | What they do |
|--------|----------------|
| **Staff** | Start a shift check, upload 3–8 photos. If the manager asks for a fix, upload one new photo later. |
| **Manager** | See problems live, agree or correct AI, assign “please fix this,” download the report. |

For the hackathon, **one café is enough**. We don’t need many shops and many companies.

### The full story in 5 steps

1. Manager has the café **rule book (SOP PDF)** and a simple **opening checklist** ready.  
2. Staff starts the **opening check** and uploads **3–8 photos** of the workplace.  
3. AI checks each checklist item and marks it **Pass**, **Gap (problem)**, or **Unclear**, and shows **which rule** it used.  
4. Manager sees the red problems, can **correct AI**, leave a note, and **assign a fix**.  
5. System exports a **1-page report** and keeps a history of what AI said and what the manager decided.

### Demo in about 90 seconds

| Time | What the audience sees |
|------|-------------------------|
| 0:00 | Messy WhatsApp-style photo chaos (the problem) |
| 0:15 | Staff uploads messy counter photos |
| 0:40 | Scoreboard: green / red / yellow(unclear) with rule quotes |
| 1:00 | Manager assigns a fix (optionally: new photo after fix) |
| 1:15 | One bad/glare photo shows as **Unclear** (this is a feature!) |
| 1:25 | Download the 1-page report |

---

## 5. What exactly are we building?

Think in two layers:

1. **Must-have core** — without this, we don’t have a product.  
2. **Extra boosts** — make the score better **after** core works.

### Core features (must finish) — C1 to C8

| # | Feature in plain words | When is it “done”? |
|---|------------------------|--------------------|
| **C1** | Basic website + logins | Staff and manager can log in to different screens |
| **C2** | Photo upload | Staff can upload several photos for one shift |
| **C3** | AI checking | AI returns results for at least 5 checklist items |
| **C4** | Scoreboard screen | Results show as Pass / Problem / Unclear table (**no chat**) |
| **C5** | Manager inbox | Manager sees new results without refreshing forever; second login works |
| **C6** | Correct + assign work | Manager can override AI and assign a fix; history is saved |
| **C7** | Demo café kit | Real-looking rule book + checklist + photos ready |
| **C8** | Report download | 1-page PDF report + ready demo accounts |

### Extra features after core (boosts #1–#6)

Do these **only when core already works**.  
If short on time, order is: **1 → 2 → 3**, then **4 → 5 → 6**.

| # | Extra feature | In plain words | Why it helps |
|---|---------------|----------------|--------------|
| **1** | Show AI steps + rule quotes | Screen shows “looking at photo → matching rule → scoring.” Every result quotes the rule. | Looks smarter and more trustworthy |
| **2** | Unclear + manager final say | If photo is blurry, AI says “Unclear.” Manager decides and reason is saved. | Honest AI; great for demo |
| **3** | Fix, then re-photo | After a problem, staff uploads one new photo; AI re-checks that item. | Full problem → fix → proof loop |
| **4** | Strong demo photo kit | Ready sets: all good, clear problems, one unclear photo | Demo never panics |
| **5** | Nicer report PDF | Report has time, summary, problems, manager decisions | Judges understand the value fast |
| **6** | “Keeps failing” strip | Small note like: “No gloves: 3 of last 5 shifts” | Shows ongoing value (keep tiny) |

### What we will **not** build

- A second industry (factory, hospital, etc.)  
- A free chat with the rule book  
- Voice notes, email alerts, fancy messaging  
- A big checklist editor (pre-made checklist is fine)  
- A full analytics dashboard  
- Claims like “we officially certify your café”  
- Hardware sensors or mobile app store apps  

---

## 6. What do we need to start?

### Team & time

| Need | Answer |
|------|--------|
| People | 2–3 teammates |
| Build time | About **4 focused days** for the working version |
| Website | A normal web app (browser-based) |
| Backend | **Appwrite Pro** (already chosen by the team) |
| AI | An existing photo-understanding AI service (we do **not** train our own model) |
| What AI coding tools can help with | Screens, forms, basic wiring |
| What humans must own | Rule book quality, demo photos, how strict “Unclear” is, pitch story |

### Accounts to set up before Day 1

- [ ] Appwrite project (logins, database, file storage, background jobs, live updates)  
- [ ] One AI photo API key (pick **one** provider and stick to it)  
- [ ] Place to host the website if judges need a public link  
- [ ] Two demo logins: one staff, one manager  

### Content we must prepare (this is not optional)

| Content | What good looks like |
|---------|----------------------|
| **Rule book (SOP PDF)** | 10–20 clear café hygiene / opening rules |
| **Checklist** | 6–8 items staff must prove with photos |
| **“All good” photos** | Clean, clearly correct scenes |
| **“Problem” photos** | Obvious issues (no gloves, dirty counter, missing sanitizer) |
| **“Unclear” photo** | Glare, too dark, or half the scene missing |
| **AI answer format** | Always the same fields: item, pass/problem/unclear, rule id, rule quote, confidence |

---

## 7. How does the system work? (simple picture)

### The flow

```
Staff takes photos
        ↓
Photos are saved
        ↓
AI looks at photos and the rule book
        ↓
Creates a scoreboard (Pass / Problem / Unclear + rule quote)
        ↓
Manager sees problems live
        ↓
Manager can correct AI and assign a fix
        ↓
(Optional) Staff uploads a new photo after fixing
        ↓
Download a 1-page report + keep history
```

### What the AI does vs what the app does

| AI does | The normal app does |
|---------|---------------------|
| Understands what is in the photos | Login and staff/manager roles |
| Matches photos to rules | Saving checklist and photos |
| Gives Pass / Problem / Unclear + confidence | Assigning tasks and showing screens |
| Re-checks one item after a fix photo (boost) | Making the PDF report and history log |

### What Appwrite is used for (non-tech view)

| Piece | Everyday meaning |
|-------|------------------|
| **Auth** | Who is logged in: staff or manager |
| **Database** | Saved shifts, scores, tasks, history |
| **Storage** | Where photos and the rule PDF live |
| **Functions** | The “run AI check” background step |
| **Realtime** | Manager screen updates almost live |

### What each AI result should contain

For every checklist item, AI should return something like:

- **Which item** (example: gloves worn)  
- **Status:** Pass / Problem / Unclear  
- **Which rule** it used  
- **A short quote** from that rule  
- **How sure it is** (confidence)  
- **What it thinks it saw** (short note)

**Golden rule:**  
If AI is not sure → mark **Unclear** and let the manager decide.  
Do **not** silently guess Pass or Fail.

### Main records we keep (simple list)

| Record | Meaning |
|--------|---------|
| Site | Our one demo café |
| SOP | The rule book file |
| Checklist | The 6–8 things to check |
| Shift | One shift check session |
| Findings | Score for each checklist item |
| Tasks | “Please fix this” jobs |
| AI jobs | Whether the AI check is waiting / running / done |
| Events | History: what AI said, what manager changed |

---

## 8. How we build it (4-day plan)

### Day by day

| Day | Must finish (core) | Nice extras if core is already working |
|-----|--------------------|----------------------------------------|
| **Day 1** | Project setup, logins, empty screens, photo upload test, one AI test on a fixed photo | Start collecting rule book + demo photos |
| **Day 2** | Full happy path: upload photos → at least 5 scored results → scoreboard | Show AI steps + force rule quotes on every row; finish photo kits |
| **Day 3** | Manager can correct results, assign fixes, see history; staff + manager logins | Strong Unclear demo; start “fix then re-photo” |
| **Day 4** | Demo accounts, report PDF, pitch script, README, backup video/screenshots | Finish re-photo loop; polish report; tiny “keeps failing” strip if time |

### Who does what (2–3 people)

| Person | Focus |
|--------|--------|
| **Person A** | Backend + AI check (saving data, running AI, confidence rules) |
| **Person B** | Screens people use (upload, scoreboard, manager inbox, buttons) |
| **Person C** (or A/B share) | Rule book, checklist, demo photos, report polish, pitch, README |

If only **2 people:**  
A = backend + AI · B = screens + demo content · share pitch on Day 4.

### Simple daily rule

1. First make the **normal success path** work.  
2. Then connect real saving/login properly.  
3. Then add the **Unclear / failure** path.  
4. Only then polish looks, PDF, and small extras.

### If the live demo goes wrong

| Problem | What we do |
|---------|------------|
| AI reads photo badly | Use pre-tested photos; show Unclear + manager override as the product feature |
| AI check is too slow | Use smaller images; have a backup recording ready |
| Internet / AI service down | Screenshots + short backup video |
| Looks like a chatbot | Never add free chat — only the scoreboard |

---

## 9. What can we expect at the end?

### If we build the core well

- A real website with **two roles**: staff and manager  
- A clear “wow” moment: photos become a rule-based scoreboard in about a minute  
- A trust story: when AI is unsure, a human decides and it is recorded  
- A downloadable 1-page report judges can understand  
- A future story for the pitch only: more rule packs / more shops later (**not built now**)

### Across the hackathon

| Stage | What we aim to deliver |
|-------|-------------------------|
| **Round 1** | Clear proposal PDF + short video (problem → demo idea → why AI → team) |
| **Round 2** | Working product on GitHub + README + 3–5 minute demo video |
| **Finale** | Live 7-minute demo: problem → photo → scoreboard → fix → report |

### What “winning the room” looks like

1. Judges get the WhatsApp mess problem in 15 seconds.  
2. They see AI doing work a normal form cannot do (reading photos against rules).  
3. They see both staff and manager roles.  
4. They see honest AI (Unclear path), not fake perfection.  
5. They remember the full loop: proof → score → fix → report.

### What we do **not** need for success

- Perfect AI on every random real-world photo  
- A real café partner  
- Legal “we certify you” language  
- Support for many industries  
- A finished company product for thousands of shops  

---

## 10. How we should talk about it (pitch)

### How Round 1 is judged

| What judges care about | Weight | How ShiftProof answers |
|------------------------|--------|------------------------|
| Fresh / creative idea | 30% | Full photo-to-report loop, not chat |
| Real problem | 20% | Small café rules ignored; WhatsApp “proof” is weak |
| AI is central | 20% | AI must look at photos and match rules |
| Can we build & grow it | 15% | One café now; more packs later |
| Clear presentation | 15% | Easy 90-second story |

### Proposal PDF outline (max 5 pages)

1. Problem: rules exist, proof is random WhatsApp photos  
2. Users: staff + owner/manager  
3. Solution + simple AI flow diagram (include Unclear / human decision)  
4. Tools: Appwrite + photo AI + website  
5. Plan: 4-day build + how it could grow later  
6. Team + demo plan  

### Words that help

- Multimodal AI (AI that can use images, not only text)  
- AI agents (AI that does a multi-step job)  
- Large language models / generative AI  

### Claims to avoid

- “We guarantee you will pass any official inspection”  
- Fake ultra-precise numbers  
- “Works for every industry on day one”

**Better phrase:**  
“Helps managers gather clear evidence and a walk-through-ready report.”

---

## 11. Rules the whole team should protect

### Hard rules (do not break)

1. **Only one industry for MVP:** café food-safety opening checklist.  
2. **Scoreboard only** — no free chat.  
3. Demo must show at least one **Unclear** example.  
4. Extra features do **not** mean we suddenly add industries, voice notes, emails, or chat.

### Main risks (and calm answers)

| Risk | Our answer |
|------|------------|
| AI misreads a photo | Show confidence; use Unclear; manager can correct |
| Weak demo content | Invest time in a strong café kit early |
| Trying to build too much | Stick to the “do not build” list |
| Looks like “just ChatGPT with a login” | No chat; always show the rule quote |
| Live internet fails on stage | Pre-tested photos + backup video |

### One more team reminder

Other ideas in our folder use a similar “upload → AI → human → tasks” shape.  
That’s fine. We still build **only ShiftProof**, and our story is:  
**café shift photos checked against real food-safety rules.**

---

## 12. “Are we done?” checklist

### Core is done when

- [ ] Staff can log in, start a shift, upload photos  
- [ ] AI finishes and gives at least 5 item results  
- [ ] Manager can log in and see the scoreboard / inbox  
- [ ] Manager can correct a result and assign at least one fix  
- [ ] Important actions are saved in history  
- [ ] Demo rule book + checklist + photos are ready in the project  
- [ ] 1-page report can be downloaded  
- [ ] There is **no** free chat screen  

### Boosts are done when (stretch goals)

- [ ] #1 AI steps + rule quote on every result  
- [ ] #2 Unclear path shown live with manager decision saved  
- [ ] #3 One “fix then re-photo” path works  
- [ ] #4 Pass / problem / unclear photo sets ready  
- [ ] #5 Report looks clear and professional  
- [ ] #6 Small “keeps failing” note (optional last)  

---

## 13. Prompt for a coding session (for builders)

When someone starts building with an AI coding tool, they can paste:

```text
We are building ShiftProof for the IIT Jammu AI First Hackathon.
Read explanation.md and output/FINAL-SHORTLIST.md first.

Build a simple web app with Appwrite:
- Two logins: staff and manager
- Staff uploads shift photos
- AI checks photos against a café food-safety checklist/SOP
- Results show as a Pass / Problem / Unclear scoreboard (no chat)
- Manager can override, assign a fix, and export a 1-page report

Only one vertical: café opening food-safety checklist.
Finish core features C1–C8 before extras #1–#6.
```

---

## 14. Where to read more (if you want detail)

| File | What’s inside |
|------|----------------|
| `PROJECT.md` | **Full project details** — identity, features, stack, plan, demo, pitch |
| `output/FINAL-SHORTLIST.md` | Final decision, feature lists, 4-day plan |
| `output/feasibility-iter1.md` | Can we ship it, cut list, demo risks |
| `output/ideas-iter1.md` | First full write-up of the idea |
| `output/review-iter1.md` | Why it scored higher than other ideas |
| `config/hackathon-context.md` | Event rules, dates, scoring |
| `config/team-profile.md` | Our team limits and preferences |

---

## 15. Bottom line for every teammate

**ShiftProof** helps a café manager stop relying on messy WhatsApp photos.  
Staff upload shift photos. AI checks them against the rule book. The manager sees clear Pass / Problem / Unclear results, assigns fixes, and downloads a simple report.

**Remember:**

1. Build the **full basic loop** first (core C1–C8).  
2. Add extras **in order** (#1 to #6) only if there is time.  
3. **Never** add free chat or a second industry during the hackathon.  
4. **Always** show the rule quote, and show an honest **Unclear** example.

If our café demo content is strong and the live demo is calm and clear, this project can look impressive, useful, and realistic — which is exactly why it ranked **#1** on our shortlist.
