# Managed image renditions — local validation, 10 November 2026

Stored originals and published image references are unchanged. Catalog uploads still retain their sanitized PNG; complete winner banners retain the existing canonical 1840 × 800 WebP upload contract. No schema, dependency, or migration was added.

`CatalogImage` requests same-origin, cookie-bound WebP candidates with actual encoded widths: 96, 192, 460, 920, and 1840 pixels. Small My Bids and quick-auction images use separate 96/192-pixel square candidates with transparent padding to preserve the complete composition. Gallery thumbnails also select small candidates through their 60-pixel `sizes` value. Existing visible-image priority remains explicit; the visible bid-sheet preview is eager.

The finite URL contract is `/api/media/<immutable-id>?v=1&rendition=image-920` or `thumb-192`, for example. Unsupported versions, dimensions, duplicate parameters, and unrelated query parameters return 400. Changing encoding requires a version change. Canonical published references remain `/api/media/<id>`.

## Measurements

Two synthetic product images were created in the disposable loopback `lowwin_nov7_browser_test` database, containing text, contrasting edge marks, a product shape, and a textured background. Measurements used the optimized Next server at `https://localhost:3166`, Chromium at 430 pixels and DPR 2, and a persistent local published-media cache. These are individual local samples, not production/mobile-device percentiles.

| Stored source | Response | Encoded dimensions | Body bytes | Reduction from source |
|---|---|---|---:|---:|
| Canonical banner | Original PNG | 1840 × 800 | 606,233 | — |
| Canonical banner | Responsive WebP | 920 × 400 | 42,564 | 93.0% |
| Canonical banner | Square thumbnail WebP | 192 × 192 | 1,676 | 99.7% |
| Legacy large image | Original PNG | 2400 × 1043 | 1,002,020 | — |
| Legacy large image | Responsive WebP | 920 × 400 | 29,070 | 97.1% |
| Legacy large image | Square thumbnail WebP | 192 × 192 | 1,646 | 99.8% |

The following comparison uses the **same rebuilt server and warmed server disk cache** for both original and rendition responses, with a fresh browser context for each row:

| Source | Response | TTFB, ms | Bitmap decode, ms | Ready plus two animation frames, ms |
|---|---|---:|---:|---:|
| 1840 | Original PNG | 13.9 | 12.8 | 37.4 |
| 1840 | 920 WebP | 9.5 | 9.5 | 27.7 |
| 1840 | 192 thumbnail | 8.7 | 1.5 | 45.3 |
| 2400 | Original PNG | 23.3 | 23.4 | 62.7 |
| 2400 | 920 WebP | 51.9 | 8.3 | 68.1 |
| 2400 | 192 thumbnail | 11.6 | 1.4 | 26.0 |

Bitmap decode measures `createImageBitmap` from an already received blob. The final column starts when the image is inserted and waits for `img.decode()` and two animation frames; it approximates paint readiness, rather than an independently measured displayed pixel. Scheduling noise is visible, and these samples do not establish a uniform TTFB or first-paint improvement. The reliable changes are fewer transferred bytes and smaller decoded images.

First derivative generation from a cached original took 161.5/172.1 ms TTFB for the two 920-pixel images and 63.6/76.8 ms for their thumbnails. Subsequent reads use their stored derivative. Existing published originals remain available while a missing derivative is generated.

The earlier server had no explicit `LOWWIN_MEDIA_CACHE_DIR`. Its original PNG sizes and dimensions match the table, but its TTFB cannot be used to isolate the rendition change because the cache configuration changed. Raw captures are `.local/nov10-media-before-initial.json`, `.local/nov10-media-after.json`, and `.local/nov10-media-after-httpcache.json`.

## Cache and privacy checks

- Original cache files remain `<id>.png`; derivatives are separate `<id>.v1.<rendition>.webp` files. The existing original fast path remains valid, including deriving an absent variant without a database query. Focused tests verify warmed derivatives also bypass the database.
- All six public original/rendition URLs returned `public, max-age=31536000, immutable`, stable ETags, and an actual **304 with a zero-byte body** when requested with `If-None-Match`.
- Browser repeats were measured without route interception and with Chromium caching enabled. This local self-signed HTTPS run still reported HTTP 200, transferred bytes, and no browser cache-hit events. Browser memory/disk cache reuse is therefore **not claimed**; server caching and conditional HTTP responses were verified independently.
- Real optimized-server HTTP requests for freshly created unpublished catalog media and unconsented winner-banner media returned 404 for original, banner, and thumbnail requests, with `private, no-store, max-age=0` and `Vary: Cookie`. None created an original or derivative in the published cache.
- Private previews and consented winner announcements never write to the shared published cache. Route tests verify authorization/consent is checked again after a prior successful rendition request; a revoked or removed announcement returns 404. Financial settlement, result publication, and notification records are untouched by image delivery.

The six focused media suites passed 39 tests; a follow-up proxy/media run passed 31 tests. Visual inspection at 430 and 1280 pixels verified complete banner composition, small square images, selected same-origin rendition URLs, and no horizontal overflow. Screenshots and real-HTTP privacy results are under `test-results/media-evidence/`. Physical Telegram behavior and production cache/delivery were not exercised.
