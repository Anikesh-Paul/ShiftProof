# Gemini Flash via Google AI Studio for shift scoring

**Status:** accepted (2026-07-25)

We need multimodal vision to score café opening photos against SOP checklist items inside Appwrite Function `runShiftScore`. We chose **Google Gemini Flash** called with a **Google AI Studio API key** (`GOOGLE_AI_API_KEY` on the Function only), not OpenAI/Anthropic as the default and not Vertex/GCP $300 credits as the primary path.

## Considered options

- **OpenAI GPT-4o** — strong vision and JSON, higher cost under iterative demo testing  
- **Anthropic Claude vision** — strong instruction-following, usually pricier for this loop  
- **Gemini Flash via AI Studio** — cheap/free-tier friendly, multimodal, fast to wire  
- **Gemini via Google Cloud / Vertex + $300 credits** — workable wallet, heavier project/IAM setup  

## Why this

Round 2 has ~days left and a Showcase Max bar. AI Studio minimizes setup time and cost while still delivering real vision (required for AI Integration scoring). GCP credits remain an **escape hatch** only if free-tier limits block the demo.

## Consequences

- Function owns the key; frontend never sees it  
- Prompting and JSON schema discipline (`FINDINGS_SCHEMA.json`) are our quality levers  
- Rate limits may require golden pre-scored shifts (see ADR 0002)  
