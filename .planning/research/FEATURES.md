# Feature Landscape: Multi-Profile Video Production Platform

**Domain:** Video content creation with workspace isolation and TTS management
**Researched:** 2026-02-03
**Confidence:** HIGH

## Table Stakes

Features users expect from multi-profile content creation tools. Missing any of these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Profile Switcher UI | Industry standard in all social media management tools (Statusbrew, Agorapulse, Planable) | Low | Dropdown/menu in navbar. Must be persistent across all pages. |
| Per-Profile Library Isolation | Prevents accidental cross-posting (critical error in agency tools) | Medium | Database scoping: `WHERE profile_id = ?` on all queries. Supabase RLS ideal but optional. |
| Per-Profile Settings Storage | Each store needs its own API keys (Postiz, TTS) | Low | JSONB column or separate `profile_settings` table. |
| Visual Profile Indicator | User must always know which profile is active | Low | Profile name + icon/color in navbar. "Store A" vs "Store B". |
| Profile-Scoped Assets | Projects and clips belong to one profile only | Medium | Add `profile_id` foreign key to `projects` and `clips` tables. |
| Default Profile on Login | Reduces friction for primary use case | Low | User preference or "last active profile". |
| TTS Provider Selection | Users expect choice between free/paid options | Low | Radio buttons or toggle. Edge TTS (free) vs ElevenLabs (paid). |
| Voice Preset Management | Voice settings must persist per-provider, per-profile | Medium | Store: provider, voice_id, model, speed, stability. Per-profile defaults. |
| Per-Profile Postiz Config | Each store publishes to different social accounts | Medium | Store API URL + API key per profile. Override global settings. |

## Differentiators

Features that set the product apart. Not expected, but provide clear value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Profile Creation Wizard | Smooth onboarding for new stores | Low | 3-step: Name → TTS defaults → Postiz credentials. Optional on setup. |
| Cross-Profile Asset Copying | Reuse successful video scripts between stores | Medium | "Copy project to [Profile]" action in library. Clones project + settings but not rendered clips. |
| Profile Activity History | Track which store generated how many videos | Low | Dashboard showing video count, API costs, last activity per profile. Builds on existing cost_tracker. |
| TTS Voice Preview | Test voice before generating full video | Medium | "Play sample" button with 1-2 sentence test. Calls TTS API with short text. |
| Multi-Provider Failover | Automatic fallback: ElevenLabs → Edge TTS if quota exceeded | High | Error handling in TTS service. Graceful degradation already exists but not explicitly user-facing. |
| Voice Library Organization | Categorize saved voices (energetic, calm, professional) | Medium | Tags/labels on voice presets. ElevenLabs pattern: 200K+ voices with categories. |
| Bulk Profile Actions | Apply same TTS settings to all profiles | Low | "Save as default for all profiles" checkbox in settings. |
| Profile-Specific Context Text | Default AI analysis prompts per store (product category differences) | Low | Profile setting: `default_context_text`. Pre-fills video upload form. |
| TTS Cost Comparison Widget | Show real-time cost: "ElevenLabs: $0.22 vs Edge TTS: $0" | Low | Label under provider selection. Uses existing cost_tracker data. |
| Postiz Account Previewer | Show connected social accounts before publishing | Medium | Fetch integrations on profile load. Display: "Instagram @store_a, TikTok @store_a_official". |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain for a 2-profile personal tool.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Team Collaboration / Multi-User | Adds complexity for zero benefit (single user, 2 stores) | Keep single-user architecture. Auth exists but no sharing. |
| Profile Permissions / RBAC | Meaningless when one person manages both profiles | Equal access to both profiles. No permission checks. |
| Profile Invitation System | No need to share profiles with others | — |
| Workspace-Level Billing | Overcomplicated for personal use | Track costs globally, show breakdown by profile in dashboard. |
| Profile Templates / Marketplace | Feature creep for 2-profile use case | Manual setup is 2 minutes per profile. |
| Advanced Profile Hierarchy | Parent/child workspaces unnecessary | Flat structure: Profile A, Profile B. No nesting. |
| Profile-Specific UI Themes | Visual customization adds no value | Consistent UI across profiles. Only name/icon differ. |
| Cross-Profile Publishing | Publishing to wrong store is the error we're preventing | Hard isolation. Must switch profiles to publish. |
| Profile Analytics Dashboard | Feature exists in Postiz already | Link to external analytics. Don't duplicate. |
| Per-Profile FFmpeg Settings | Video output format same for both stores (social media standards) | Global FFmpeg config. Profile independence is content/accounts, not encoding. |
| Desktop App Profile Sync | Browser-based tool doesn't need desktop sync | Web-first architecture remains. Supabase handles state. |
| Profile Backup/Export | Overkill for 2 profiles with shared database | Supabase backup covers both profiles. |

## Feature Dependencies

```
Profile System Foundation (database schema)
  ↓
Profile Switcher UI (selection mechanism)
  ↓
Profile-Scoped Data Loading (library isolation)
  ↓
├─→ Per-Profile Settings (TTS, Postiz)
├─→ TTS Provider Selection UI
├─→ Voice Preset Management
└─→ Postiz Config Per-Profile
```

**Critical Path:**
1. Database schema changes (add `profile_id` to tables)
2. Profile switcher UI (navbar component)
3. Data scoping (filter queries by active profile)
4. Settings storage (per-profile configurations)

**Independent Features (can be built in parallel):**
- TTS provider selection UI (works without profiles)
- Voice preset management (can be profile-scoped later)
- TTS cost comparison widget (informational only)

## MVP Recommendation

**For initial profile system implementation, prioritize:**

1. **Profile Switcher UI** (table stakes, low complexity)
   - Dropdown in navbar showing "Store A" / "Store B"
   - Persists selection in localStorage or user preferences
   - Visual indicator always visible

2. **Per-Profile Library Isolation** (table stakes, medium complexity)
   - Add `profile_id` to projects/clips tables
   - Filter all library queries by active profile
   - Migration: assign existing data to default profile

3. **Per-Profile Postiz Config** (table stakes, medium complexity)
   - Store Postiz API URL + key per profile
   - Override global settings when active
   - Fallback to global if profile config missing

4. **TTS Provider Selection UI** (table stakes, low complexity)
   - Radio buttons: "ElevenLabs (paid)" vs "Edge TTS (free)"
   - Show costs inline: "$0.22/1000 chars" vs "Free"
   - Surfaces existing Edge TTS integration

**Defer to post-MVP:**

- **Voice Preset Management**: Can manually configure voices per-upload initially. Presets are convenience, not blocker.
- **Profile Creation Wizard**: Two profiles can be set up manually via settings page.
- **TTS Voice Preview**: Nice-to-have. Users can iterate on full clips.
- **Cross-Profile Asset Copying**: Edge case for later optimization.
- **Profile Activity History**: Informational dashboard feature, not workflow-critical.

## TTS Provider Selection: UX Patterns

Based on research from ElevenLabs documentation and industry standards:

### Expected UI Elements

| Element | Purpose | Edit Factory Implementation |
|---------|---------|---------------------------|
| Provider Toggle | Switch between paid/free | Radio group: ElevenLabs / Edge TTS |
| Cost Display | Show pricing inline | "~$0.22 per 1000 characters" vs "Free (Microsoft)" |
| Voice Selection | Choose specific voice | Dropdown with voice names. ElevenLabs uses voice library pattern. |
| Voice Preview | Test voice before use | "Play sample" button (differentiator, not MVP) |
| Provider Badge | Visual indicator of active provider | Badge in TTS panel: "Premium" (ElevenLabs) or "Free" (Edge TTS) |

### Current State Analysis

Edit Factory's `tts-panel.tsx` currently:
- ✓ Labels as "ElevenLabs" explicitly
- ✓ Shows "Premium" badge
- ✗ No provider selection (ElevenLabs hardcoded in UI)
- ✗ Edge TTS exists in backend but hidden from user

**Gap:** Users can't choose between free/paid TTS providers in the UI. Edge TTS fallback is invisible.

### Recommended UX Pattern

```
┌─────────────────────────────────────────┐
│ Text-to-Speech Provider                 │
│ ○ ElevenLabs (~$0.22/1000 chars) [Premium]│
│ ● Edge TTS (Free)                       │
│                                         │
│ Voice: [Rachel (en-US)        ▼]       │
│ [Play sample]                          │
│                                         │
│ [Textarea for script...]               │
└─────────────────────────────────────────┘
```

**Key Decisions:**
1. Default to **Edge TTS (free)** for new profiles → minimizes costs
2. Show provider selection **above voice selection** → hierarchy matters
3. Display **inline costs** → informed decision without clicking help text
4. **No automatic failover UI** → fallback is silent backend behavior
5. **Per-profile default** → Store A uses ElevenLabs, Store B uses Edge TTS

## Voice Preset Management Patterns

Research from ElevenLabs docs and social media tools:

### Industry Standard Features

| Feature | Found In | Edit Factory Need |
|---------|----------|-------------------|
| Voice library with 200K+ options | ElevenLabs, Speechmatics | Overkill for 2-profile personal tool |
| Voice categorization (narrator, companion, actor) | ElevenLabs | Unnecessary |
| Emotion profiles (calm, energetic, serious) | Fish Audio TTS 2026 | Unnecessary for product videos |
| Multi-voice management (up to 8 voices per bank) | ComfyUI-Qwen-TTS | Edge case |
| Named voice registries | Multiple TTS platforms | **Useful: "Store A Default Voice"** |
| Auto-load pre-computed features | Industry best practice | **Useful: Save voice_id + settings** |

### Recommended Scope for Edit Factory

**Store per-profile:**
- Provider (elevenlabs / edge_tts)
- Voice ID (e.g., "Rachel", ElevenLabs voice ID)
- Model (e.g., "eleven_multilingual_v2")
- Speed (optional fine-tuning)
- Stability (ElevenLabs-specific)

**Do NOT build:**
- Voice cloning (feature exists in ElevenLabs but unnecessary)
- Voice design from prompts (overkill)
- Emotion control sliders (product videos have consistent tone)
- Multi-voice dialogue (single narrator per video)

**Storage Pattern:**

```json
{
  "profile_id": "store_a",
  "tts_provider": "edge_tts",
  "tts_voice_id": "en-US-RachelNeural",
  "tts_model": null,
  "tts_settings": {
    "speed": 1.0
  }
}
```

## Workspace Isolation Patterns (Reference)

Research from social media management tools (Statusbrew, Agorapulse, Planable):

### Common Isolation Mechanisms

| Pattern | Description | Edit Factory Applicability |
|---------|-------------|---------------------------|
| **Separate Workspaces** | Complete data isolation, each client/brand has independent environment | ✓ **Use this**: Each store is a workspace |
| **Profile Groups** | Organize multiple social accounts under one client with shared permissions | ✗ Not needed (no multi-account per store) |
| **User Groups** | Control team member access to specific profiles | ✗ Single user |
| **Approval Workflows** | Per-client content review before publishing | ✗ Instant publish for personal use |
| **Workspace Pricing** | $39/month per workspace (Planable) | ✗ Personal tool, free concept |

### Key Takeaway for Edit Factory

The critical pattern is **preventing accidental cross-posting**. In agency tools, this means posting Client A's content to Client B's Instagram. In Edit Factory, this means posting Store A's product video to Store B's TikTok account.

**Solution:** Hard isolation via profile switcher. Must explicitly switch profiles to access different store's library and Postiz credentials.

## Complexity Assessment

| Feature Category | Estimated Effort | Risk Level |
|-----------------|------------------|------------|
| Profile switcher UI | 2-4 hours | Low |
| Database schema (add profile_id) | 1-2 hours | Low (additive change) |
| Data scoping (query filters) | 4-6 hours | Medium (must update all queries) |
| Per-profile settings storage | 2-3 hours | Low |
| TTS provider selection UI | 3-4 hours | Low |
| Voice preset management | 4-6 hours | Low-Medium |
| Per-profile Postiz config | 3-5 hours | Medium (service instantiation change) |
| Profile creation wizard | 4-6 hours | Low (nice-to-have) |

**Total MVP Estimate:** 16-24 hours for core profile system + TTS improvements

## Sources

### Workspace Isolation Research
- [Top 10 Social Media Management Tools for Agencies in 2026](https://statusbrew.com/insights/social-media-management-tools-for-agencies)
- [15 social media management tools for cross-functional teams in 2026](https://monday.com/blog/project-management/social-media-management-tools/)
- [Best Social Media Manager Tools in 2026: Complete Comparison Guide](https://fedica.com/blog/best-social-media-manager-tools-comparison-guide/)
- [Best 20 social media management tools in 2026](https://contentstudio.io/blog/social-media-management-tools)
- [Best AI Content Creation Tools for Enterprises (2026)](https://ltx.studio/blog/best-ai-content-creation-tools-for-enterprises)
- [15 best content creation tools for marketing teams in 2026](https://planable.io/blog/content-creation-tools/)

### TTS Provider Management
- [Text to Speech (product guide) | ElevenLabs Documentation](https://elevenlabs.io/docs/creative-platform/playground/text-to-speech) (MEDIUM confidence - verified via WebFetch)
- [Voices | ElevenLabs Documentation](https://elevenlabs.io/docs/overview/capabilities/voices)
- [Voice UI Design: Best Practices, Examples & Inspiration (2026)](https://www.eleken.co/blog-posts/voice-ui-design)
- [Best TTS APIs for Real-Time Voice Agents (2026 Benchmarks)](https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks)
- [Best TTS APIs in 2026: Top 12 Text-to-Speech services for developers](https://www.speechmatics.com/company/articles-and-news/best-tts-apis-in-2025-top-12-text-to-speech-services-for-developers)
- [AI Text-to-Speech Tool Recommendations: 2026's Best Free TTS Solutions](https://fish.audio/blog/free-text-to-speech-guide-2026/)

### Multi-Store E-commerce Patterns
- [How Social Commerce is Reshaping Ecommerce & Retail (2026)](https://www.bigcommerce.com/articles/omnichannel-retail/social-commerce/)
- [How to use social media ecommerce effectively in 2026](https://sproutsocial.com/insights/social-media-ecommerce/)
- [Top 14 Paid Social Media Management Tools for E-commerce](https://madgicx.com/blog/paid-social-media-management-tool)

### Video Editing Workspace Features
- [DaVinci Resolve | Blackmagic Design](https://www.blackmagicdesign.com/products/davinciresolve/)
- [17 Best Video Editing Platforms for 2026](https://www.youngurbanproject.com/video-editing-platforms/)
- [The Future of Video Editing: Trends and Predictions in 2026](https://filmora.wondershare.com/trending-topic/the-future-of-video-editing-trends-and-predictions.html)

### Personal vs Team Workspace Patterns
- [Teams & Workspaces | AI Studios Collaboration](https://www.aistudios.com/features/workspace)
- [Top 10 Digital Workspace Platforms in 2026](https://www.udext.com/blog/digital-workspace-platform-features)
- [20 Best AI Tools for Business Reviewed in 2026](https://peoplemanagingpeople.com/tools/best-ai-tools-for-business/)
