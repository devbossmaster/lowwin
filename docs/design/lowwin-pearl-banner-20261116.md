# LowWin banner refresh — 16 November 2026

The current banner uses a pearl/champagne studio backdrop with restrained blue ribbon accents. The family and prize composition remains illustrative. Inter and Noto Sans Ethiopic are rendered from the existing self-hosted files; no generated lettering or additional logo is used.

Assets:

- `public/images/lowwin-pearl-banner-{en,am}-20261116.webp`: 1840 × 800, desktop/shared marketing.
- `public/images/lowwin-pearl-home-{en,am}-20261116.webp`: 1600 × 900, mobile Home.
- `docs/design/lowwin-family-pearl-blue-20261116.webp`: preserved text-free source.
- `public/images/lowwin-pearl-20261116.provenance.json`: dimensions, hashes and file sizes.

Rebuild typography with `node docs/design/render-home-banner.mjs`. The original files remain available to cached clients. The existing public-asset allowlist exposes only the named campaign artwork; private media rules are unchanged. Published custom banners retain their own URLs.

The requested `relative overflow-hidden` banner and `absolute inset-0 bg-gradient-to-t from-foreground/70 via-foreground/25 to-transparent` overlay are applied in HomeHero. A scoped CSS gradient supplies the same foreground opacity without depending on a global foreground theme token. Existing Home image art direction, small overlay buttons and eager first-visible image loading are retained.

## Built-in ImageGen edit prompt

Edit the supplied LowWin promotional hero artwork, preserving the same four smiling Ethiopian family members, their identities, expressions, poses and clothing, same blue bicycle, red suitcase, potted plant, retail phone box and PlayStation 5 retail box. Change only the backdrop, podium material, and lighting art direction. Replace the flat medium-blue background with an elegant luminous PEARL WHITE / PALE CHAMPAGNE studio backdrop with smooth sculpted looping ribbon arches and gentle warm gold reflections like premium product-ad packaging, with restrained royal-blue accents tying it to LowWin branding. Keep white reflective foreground podium/floor. Premium polished photographic campaign, natural skin colors, clean generous negative space on LEFT 36% for separately typeset website copy; people and products remain entirely on right 64%, clearly recognizable and not cropped. Shape the arcs behind the family rather than cluttering the empty left. NO TEXT, NO LETTERING, NO LOGO, NO BUTTONS, NO UI, NO WATERMARK. Landscape 16:9, full bleed, sharp square edges, no frame. Retain exact products and family, avoid new decorative objects. This is background art for a responsive auction website, high-quality photorealistic illustrative scene.

## Validation

- 34 focused unit tests passed: auction details, live bid counts, banner mapping and bot welcome assets.
- TypeScript check passed.
- `node node_modules/next/dist/bin/next build --webpack` passed, including type checks, 38 static pages and build traces. The enclosing `npm run build` command first stopped at Prisma generation because Windows locked `query_engine-windows.dll.node`; the successful Next build reused the existing generated client. This UI change introduces no schema change.
- 16 local Chromium cases passed: banner and product detail at 320, 360, 430 and 1280px, English and Amharic. Public catalog, account and payment reads were fixtures; no external requests or database writes occurred.
- No page overflow; balanced fee/count/timer cells, working image decoding, requested gradient, green terms strip and live-only related auctions verified. Empty related lists omit the section. The old description/specification block and long terms accordion are removed from the live detail view.
