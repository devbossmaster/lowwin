---
name: Lowin mobile system
description: A warm, restrained mobile interface for Telegram.
colors:
  background: "#F7F7F2"
  foreground: "#172720"
  primary: "#157A55"
  forest: "#103C30"
  mint: "#E5F4EB"
  border: "#DBE7DE"
  muted: "#54665C"
  outer-canvas: "#E8ECE7"
  white: "#FFFFFF"
typography:
  display:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "clamp(34px, 9.6vw, 45px)"
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
rounded:
  control: "12px"
  identity: "14px"
  feature: "16px"
spacing:
  small: "8px"
  medium: "16px"
  inset-compact: "20px"
  inset: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
  button-primary-hover:
    backgroundColor: "{colors.forest}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
  button-outline-hover:
    backgroundColor: "{colors.mint}"
---

# Lowin mobile system

## Overview

The supplied brief is the visual authority: warm off-white, forest green, primary green and mint, built for mobile web inside Telegram. This is a code-led implementation of that brief; no generated visual comp establishes additional rules.

The interface uses compact typography, restrained borders and clear account states. The lowercase text wordmark is replaceable. The Phase 1 foundation needs no product imagery, invented inventory or decorative live statistics.

## Colors

Primary green marks actions, icons and emphasis. Forest anchors the wordmark and dark feature surfaces. Mint distinguishes active navigation, verified identity and the winning example. Warm off-white is the application surface; ink is the main text color, muted green-gray supports secondary copy, and soft borders separate rows and containers. The outer canvas frames the phone layout on wider screens.

Keep the palette light. Dark mode is deferred. Do not introduce dominant lime or gold.

## Typography

Use self-hosted DM Sans with a sans-serif fallback throughout. The display role is for the home headline; other page titles use 34px. Section headings use the headline role, and compact item headings use 15px at weight 600.

Body copy uses the body role. Supporting copy generally uses 13–14px; small labels use 10–12px. Home introductory copy is limited to 32ch with a 1.7 line height. Point amounts and balances use tabular numerals. The header wordmark is 32px, weight 700, with tight tracking and a green terminal dot.

## Layout

Center a single mobile canvas with a maximum width of 480px and minimum height of 100dvh. Preserve that phone layout on wide displays and profile subpages. Content normally has 24px horizontal insets; at widths up to 370px, primary sections use 20px. The top bar uses 22px, reducing to 18px at that breakpoint.

The top bar contains the home wordmark, wallet chip, alerts and profile. Persistent bottom navigation uses five equal columns and stays aligned with the canvas. Reserve 82px plus the bottom safe-area inset in the page so content can scroll clear of it. Top and bottom padding respect the larger of the browser safe-area inset and Telegram content-safe-area inset.

Utility links and controls have at least 44px tap targets, including the wordmark, text links and the home shortcuts. Primary buttons and bottom-navigation targets have at least 48px height. The home shortcuts lead to How it works and Auctions; they are functional links rather than an eyebrow label. Mobile checks cover 360px and 430px widths; these are validation sizes, not CSS breakpoints.

## Elevation & Depth

Surfaces are flat, without decorative shadows. Tonal contrast, thin borders and spacing define groups. Forest feature panels provide the strongest visual emphasis; mint highlights a meaningful state within them. The illustrative winning tile rises by 5px to reinforce its distinction.

## Shapes

Controls and active navigation use gently rounded corners from the control token. Identity panels use the identity radius, while feature and wallet panels use the feature radius. Small demonstration tiles use 10px corners. Wallet chips are pill-shaped; avatar and icon targets are circular. Borders are thin and quiet.

## Components

Buttons use a semibold 14px label, 20px horizontal padding and an 8px content gap. Primary buttons use green with white text and turn forest on hover. Outline buttons use the soft border, ink text and transparent fill, turning mint on hover. Disabled buttons reduce opacity and suppress pointer interaction.

Focus is visible with a 2px green outline offset by 4px. Preserve the skip link and accessible names on icon-only controls. Motion is restrained: the loading indicator alternates over 1.2 seconds, and reduced-motion preferences disable animation and transitions.

The wallet chip shows a neutral Points label for guests and the authenticated available balance when present. Bottom navigation combines icons with labels: Home, Auctions, Winners, My Bids and Profile. The current route uses green text on mint and exposes its current-page state.

Identity panels distinguish loading, guest, reconnect/error and unavailable launch configuration. Verified identity appears in a compact mint line. Retry and Telegram launch actions appear only when applicable. Features outside Phase 1 use honest not-open states rather than populated mock content.

The home rule demonstration presents four amounts in equal columns and is explicitly labelled Example. The unique minimum has mint fill and a check; duplicated amounts have crosses. Supporting text explains the result so color alone does not convey the rule. This is an illustration, never a live auction statistic.

## Do's and Don'ts

- Do preserve the warm palette, visible focus, comfortable tap targets and Telegram safe areas.
- Do use typography, spacing and borders to establish hierarchy.
- Do keep authenticated balance displays tied to server data.
- Do label examples clearly and keep account and feature states truthful.
- Don't fabricate inventory, wallet activity or live counts to fill empty surfaces.
- Don't replace the phone canvas with a desktop dashboard layout.
- Don't treat the temporary text wordmark as a supplied final logo.
