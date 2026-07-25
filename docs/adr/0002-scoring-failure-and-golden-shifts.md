# Scoring failure policy: no silent stub + golden shifts

**Status:** accepted (2026-07-25)

Showcase Max requires real vision on the happy path. Live demos also fail if the model API is down. We decided:

1. **Default:** Gemini failure (timeout, 429, bad JSON) → agent job `failed` (and audit event). **No silent auto-stub** that invents Pass/Gap/Unclear as if AI ran.  
2. **Optional explicit emergency:** env flag such as `ALLOW_DEMO_STUB_SCORES=1` for operator-only fallback — never the default, never the “live AI” segment of the submitted video without disclosure.  
3. **Golden pre-scored shifts:** 1–2 shifts already scored in the database so the video backup can show override → export if live scoring dies mid-take.

## Why not silent auto-stub

Silent stubs undermine AI Integration (25% of Round 2) if judges notice identical fake patterns, and they train the team to demo a lie.

## Consequences

- Client `scoreShift` local stub must not be the default success path after S1  
- S2 must seed golden shifts  
- Video script prefers live Gemini; golden path is insurance only  
