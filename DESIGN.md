---
name: ShiftProof
description: Premium product UI — Fraunces display + Plus Jakarta Sans, ember accent, manager-first gaps
colors:
  bg: "#f7f6f4"
  bg-elevated: "#ffffff"
  label: "#2c241f"
  primary: "#a83828"
  on-primary: "#fcfcfc"
  danger: "#b53a2a"
  success: "#2d7a52"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 600
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
spacing:
  content-max: "28rem / 36rem desktop"
  shell-max: "42rem / 48rem desktop"
  touch: "48px"
---

# Design System — ShiftProof

## Overview

Product register, web, restrained. **Display:** Fraunces. **UI:** Plus Jakarta Sans. Brand ember on calm near-white canvas. Manager gap-first; accent only on primary actions.

Tokens: `web/src/styles/tokens.css`.

## Colors

Restrained: neutrals + ember primary ≤10%. Semantic Gap / Pass / Unclear always labeled.

## Typography

Fraunces for H1 / wordmark. Plus Jakarta Sans for UI, labels, body. No uppercase section eyebrows.

## Elevation

Hairline borders + short shadows. Solid sticky action bar (no content bleed).

## Components

Shell (wordmark + quiet role + quiet logout), Button (primary / secondary / ghost / quiet / danger), StatusChip, FindingChip, cards, manager sticky actions.

## Do's and Don'ts

**Do:** calm hierarchy, labeled status, gap-first manager, demo scoreboard when live findings empty.

**Don't:** red logout, uppercase AI kickers, duplicate controls, glass sticky over list content, SaaS purple.
