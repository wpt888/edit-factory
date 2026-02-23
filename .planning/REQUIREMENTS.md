# Requirements: Edit Factory

**Defined:** 2026-02-23
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v7 Requirements

Requirements for v7 Product Image Overlays. Each maps to roadmap phases.

### Product-Segment Association

- [ ] **ASSOC-01**: User can associate a catalog product with a segment
- [ ] **ASSOC-02**: User can remove a product association from a segment
- [ ] **ASSOC-03**: User can view which product is associated with each segment (thumbnail + name)
- [ ] **ASSOC-04**: User can select which image(s) from the product gallery to use on a segment

### PiP Overlay

- [ ] **OVRL-01**: User can enable PiP overlay of product image on a segment
- [ ] **OVRL-02**: User can choose PiP position (top-left, top-right, bottom-left, bottom-right)
- [ ] **OVRL-03**: User can choose PiP size (small, medium, large)
- [ ] **OVRL-04**: User can choose PiP animation style (static, fade in/out, Ken Burns)

### Interstitial Slides

- [ ] **SLID-01**: User can insert an interstitial product slide between segments
- [ ] **SLID-02**: User can configure interstitial slide duration (0.5s - 5s)
- [ ] **SLID-03**: Interstitial slide displays product image full-screen with Ken Burns animation

### Frontend Integration

- [ ] **UI-01**: Segments page shows product association controls per segment
- [ ] **UI-02**: Pipeline page shows product association controls per matched segment
- [ ] **UI-03**: Product picker dialog searches/filters catalog products
- [ ] **UI-04**: Image picker shows all available images for selected product

### Render Integration

- [ ] **REND-01**: Assembly/render pipeline applies PiP overlays during video composition
- [ ] **REND-02**: Assembly/render pipeline inserts interstitial slides at segment boundaries
- [ ] **REND-03**: Rendered video uses selected product images with chosen animation style

## Future Requirements

None deferred — all identified features scoped to v7.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-associate products based on video content | AI matching is complex and error-prone; user picks manually |
| Product overlay on product-first videos | Product videos already have product visuals; overlays are for upload/script workflows |
| Animated text overlays on PiP | Keep PiP simple — image only, text overlays are a separate feature |
| Multiple products per segment | One product per segment keeps UI and render simple |
| PiP on interstitial slides | Interstitials are full-screen by definition |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ASSOC-01 | Phase 32 | Pending |
| ASSOC-02 | Phase 32 | Pending |
| ASSOC-03 | Phase 32 | Pending |
| ASSOC-04 | Phase 32 | Pending |
| OVRL-01 | Phase 35 | Pending |
| OVRL-02 | Phase 35 | Pending |
| OVRL-03 | Phase 35 | Pending |
| OVRL-04 | Phase 35 | Pending |
| SLID-01 | Phase 36 | Pending |
| SLID-02 | Phase 36 | Pending |
| SLID-03 | Phase 36 | Pending |
| UI-01 | Phase 34 | Pending |
| UI-02 | Phase 34 | Pending |
| UI-03 | Phase 33 | Pending |
| UI-04 | Phase 33 | Pending |
| REND-01 | Phase 37 | Pending |
| REND-02 | Phase 37 | Pending |
| REND-03 | Phase 37 | Pending |

**Coverage:**
- v7 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-23*
*Last updated: 2026-02-23 after roadmap created — all 18 requirements mapped*
