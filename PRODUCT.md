# Lowin

## Platform
Mobile web inside Telegram, with public read-only browsing. This is an independent repository.

## Stack
Next.js App Router, strict TypeScript, Tailwind, shadcn/ui conventions, Prisma/PostgreSQL, Better Auth, grammY and a separate Node worker. Owner selected Vercel initially, with a possible later move to VPS; the worker needs a separate always-on host.

## Product truth
The smallest integer point amount appearing exactly once wins. No unique amount means no winner. Up to 100 different amounts per user per auction. Reserve the maximum bid, not the sum; disclose any entry fee. Points have no assumed ETB conversion, transfer or withdrawal path.

## Current scope
Phase 1: verified Telegram identity, bot launch, mobile shell and database-enforced journal foundation. Catalog, bidding and settlement arrive in later reviewed phases. Never fabricate inventory, wallet activity or live counts.

## Identity and funds
Better Auth opaque user IDs own domain data. Telegram IDs are unique verified external identities. Future phone linking needs an active session and SMS proof, without automatic merges. Top-up provider and terms are undecided; production issuance remains disabled.

## Brand commitments
Warm off-white, forest green, primary green and mint. Replaceable text wordmark; no supplied logo or licensed product images. Comfortable phone tap targets, visible focus and Telegram safe areas.
