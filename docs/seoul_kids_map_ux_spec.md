# Seoul Kids Map UX Improvement Spec

Target repo: `jaybleee/seoulkidscafe`  
Target path: `/explore/`  
Date: 2026-06-14

## Priority Plan

### P0

- Add missing `유아` quick age chip.

### P1

- Reduce mobile header height so the map/list content appears above the fold.
- Move filter access into the quick filter bar.
- Clarify category tab active states with category colors and underline.
- Separate quick filters into filter action, core conditions, and age conditions.
- Redesign list cards from horizontal thumbnail cards into vertical cards with a 120px banner image.
- Put category and operating status badges over the image.
- Promote place name above secondary tags.
- Convert long age/fee/parking/operation data into short pill facts.
- Keep primary CTAs visible in the card footer.
- Improve map popup with district, category, compact image/fallback, facts, and direct CTA.
- Replace map popup single "목록에서 상세보기" flow with direct official/reservation actions.
- Replace mobile select-heavy filters with inline controls in a later step.
- Add sticky filter panel header and result CTA in a later step.
- Add marker clustering in a later step.
- Add reservation link fields and UI handling.

### P2

- Add empty state for zero results.
- Add skeleton loading cards.
- Add result count and map/list toggle in one compact row.
- Normalize CSS design tokens.
- Add local favorite storage.

### P3

- Build reservation open alerts with crawler, backend subscription storage, and web push.

## Implementation Notes

- The first implementation pass should focus on mobile usability without changing the existing `/web/` or `/museums/` pages.
- `/explore/` remains the integration experiment page until it is approved as the replacement.
- Favorites can be implemented client-side with `localStorage` before any login or backend exists.
- Reservation open alerts require a backend and should not be bundled into the static MVP.
