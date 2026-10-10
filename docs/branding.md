# Vitrine identity

Vitrine is a personal watch collection and research app. The identity is warm,
editorial, and expressive: an espresso signature wordmark, azalea accents, and
porcelain surfaces.

## Logo assets

- `public/brand/vitrine-wordmark.svg`: outlined signature wordmark, including the
  approved curled V. Derived from the approved concept and traced into paths;
  no font installation or remote image service is needed.
- `public/brand/vitrine-icon.svg`: espresso V on azalea, for compact applications.
- `public/brand/favicon-32.png` and `apple-touch-icon.png`: raster icon exports.

Keep the aspect ratio and leave clear space around the artwork. Use the espresso
wordmark on light backgrounds. Use `BrandLogo` in the app so public asset URLs
include the GitHub Pages base path (`/vitrine`) when needed.

## Typography

Manrope is the UI typeface, self-hosted through `next/font/local`. It is used for
headings, watch names, navigation, buttons, forms, and numbers. Tabular numerals
keep prices and specifications aligned. The serif is exclusive to the outlined
logo and monogram; there is no serif UI font. The font's SIL Open Font License
is stored beside the font in `public/fonts/OFL-Manrope.txt`.

## Color

Tailwind's `cocoa` and `azalea` scales in `tailwind.config.ts` are the source of
truth. Shared controls live in `src/app/globals.css`.

| Role | Token | Color |
| --- | --- | --- |
| Primary actions and logo | cocoa-900 | #3D2926 |
| Body text | cocoa-950 | #281E1C |
| Selected controls and brand accent | azalea / azalea-400 | #F578B0 |
| Page background | cocoa-50 | #FAF6F3 |
| Card background | white | #FFFFFF |
| Subtle dividers | cocoa-200 | #E6DAD5 |
| Secondary text | cocoa-500 | #75625C |
| Links | azalea-700 | #922452 |

Use dark espresso text on vivid pink, never small white text. Pink is for
selection and brand emphasis. A dark focus outline provides contrast on both
pink and white. Existing green, amber, red, and blue evidence/status cues retain
their meanings; brand pink does not imply a good deal or a warning.
