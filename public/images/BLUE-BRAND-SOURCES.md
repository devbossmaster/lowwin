# Blue Lowwin artwork — 13 November 2026

Requested by the user: restore the existing family/product banner with blue-to-black styling and recolor the existing LW logo blue. Generated with the built-in `image_gen` tool. The original banner and logo files remain unchanged. The family scene is illustrative, not a winner or inventory claim.

## Delivered assets

- `lowwin-blue-banner-en-20261113-v2.webp`: 1840 × 800, 224,996 bytes.
- `lowwin-blue-banner-am-20261113-v2.webp`: 1840 × 800, 220,090 bytes.
- `lowwin-blue-logo-20261113.webp`: 192 × 192, 2,542 bytes.
- `lowwin-blue-icon-20261113.png`: 192 × 192, 27,664 bytes.

Sharp performed resizing and encoding only. Full provenance, original filenames and hashes are recorded in `lowwin-blue-brand-20261113-v2.provenance.json`. The first blue revision remains preserved. The final revision follows the user's additional request to bring the family forward and replace the coffee maker with sealed retail-packaged iPhone Pro Max and PlayStation 5 Slim products. These are illustrative promotional images, not assertions of current auction inventory.

## Prompt set

English banner:

> Edit this exact Lowwin promotional banner. Preserve the same Ethiopian family faces/poses, same blue bicycle, black coffee maker, red suitcase, existing Low Win gavel logo and all text exactly: 'Small price.' 'Big joy.' 'The lowest unique bid wins.' The only creative change is brand color treatment: replace gold title 'Big joy.' with vivid royal blue #2563EB and replace green in Low Win logo with the same blue. Change dark background/ambient styling to a refined blue-to-black gradient, dark midnight navy and charcoal with a restrained blue glow. Preserve natural warm skin tones, realistic photo quality and red luggage. Reformat composition to a wide website banner 1840x800 aspect ratio (2.3:1), full bleed, no margins/borders, maintaining text on left and family/products right. Keep all text readable and preserve original recognizable scene, no new products, no new copy, no UI controls.

Logo:

> Edit the provided exact square Lowwin logo. Preserve the precisely interlocked bold LW letter shapes, white W, centered composition, spacing, and small letterspaced LOWWIN wordmark exactly as supplied. Change only the lime-green L to rich royal blue #2563EB and the dark-green background to very dark charcoal #101722 with a subtle black-to-midnight-blue gradient. Clean crisp professional flat logo edges, square export, no extra symbols, no new copy, no padding changes, do not redesign the letter shapes.

Amharic banner:

> Edit target image1 (Amharic Lowwin family banner) using image2 only as blue-black color/composition reference. Keep all exact Amharic text of image1, family faces/poses and products unchanged. Use a wide1840x800 (2.3:1) composition like image2. Replace green in logo and gold/yellow headline with vivid royal blue #2563EB; use refined black-midnight-blue gradient behind text and blue ambient accent. Keep natural skin and red suitcase. Preserve Amharic text exactly: 'ትንሽ ዋጋ።' 'ትልቅ ደስታ።' 'ዝቅተኛና ያልተደገመ' 'ዋጋ ያሸንፋል።' Do not add English headline or controls. Full bleed banner, no margins/borders.

The generated Amharic lettering was visually compared to the original, while the page retains exact accessible Unicode copy. Generated lettering is not a substitute for a native-language review.

Final English revision prompt:

> Edit this existing Lowwin1840x800 websitebanner. Latest specific user changes: bring the same smiling Ethiopian family forward into the foreground so they are prominent and welcoming. Replace the black coffee maker on the foreground table with TWO premium retail-packaged products: a sealed iPhone Pro Max box and a sealed PlayStation5Slim retailbox side by side. Show recognizable packaging, clean realistic scale, neither a loose phone nor looseconsole. Do not add pricing or unsupported promotionalclaims. Preserve blue bicycle and red luggage if space allows, original family identities/natural skin/clothing, blue-black gradient atmosphere, left Low Win bluegavel logo and exact text: 'Small price.' 'Big joy.' 'The lowest unique bid wins.' Keep left text completely legible. Family should be closer and visually central on right, with packageboxes on foregroundtable belowfaces. Photorealistic, no extra people, no malformed hands, no UIcontrols. Fullbleed2.3:1banner.

Final Amharic revision prompt:

> Produce the Amharic localization of image1. Image1 is the definitive new banner: preserve the foreground smiling Ethiopian family, sealed iPhoneProMax and PlayStation5Slim retailboxes ontable, bluebicycle, redsuitcase, blue-blackgradient, LowWinbluegavellogo and all layout. Use image2 only as Amharic lettering reference. Replace English headline/subtitle onleft with exact Amharic: 'ትንሽ ዋጋ።' (white) 'ትልቅ ደስታ።' (royalblue#2563EB) 'ዝቅተኛና ያልተደገመ' 'ዋጋ ያሸንፋል።' (white). Do not change family/products or addclaims. Fullbleed1840x8002.3:1 websitebanner.

## Integration and verification

Home uses the localized assets as its default banner, retaining admin-configured custom artwork. The full 2.3:1 composition is displayed without an overlay headline. Existing Learn more and Recent winners actions remain directly below the image. Shared `brand.ts` supplies the blue logo and metadata icon. Exact public-asset allowlist entries permit guest rendering.

An isolated actual-component check at 320px Amharic, 430px English and 1280px English found no viewport overflow, missing images, runtime errors or external/API requests. The only clipped text detected is the intentionally screen-reader-only headline and description. Existing cached Home content survives a simulated refresh failure.
