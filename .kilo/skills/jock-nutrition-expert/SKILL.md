---
name: jock-nutrition-expert
description: Use for any JACK NUTRITION task — Supabase, vanilla JS, PWA, Edge Functions, admin panel, project conventions. Trigger when working with app.js, admin/app.js, sw.js, supabase/functions, or project architecture.
---
# JACK NUTRITION Expert

## Project
Static supplement store: vanilla JS + Supabase, GitHub Pages.
- Frontend: index.html, styles.css, app.js
- Admin: admin/index.html, admin/styles.css, admin/app.js
- Backend: Supabase (PostgreSQL + Edge Functions + Storage)
- No build step, no bundler, no modules

## Commands
- `npm start` — opens index.html
- `npm run lint` — no-op (static site)
- `npm run typecheck` — no-op

## Key Patterns
- Cart: localStorage 'jock-cart', only {id, quantity}
- Favorites: localStorage 'jock-favorites', array of UUIDs
- Settings: fetched from admin-api/settings, cached in window.__storeSettings
- Price protection: all calculations in Edge Function create-order
- No visitor tracking: no cookies, no IP logs
- Order time limit: checkOrderTime() using timezone setting

## Supabase Patterns
- REST API: /rest/v1/table?select=*
- Edge Functions: Deno, service_role key for RLS bypass
- Auth: JWT in Authorization header
- Storage: product-images bucket, public read

## Code Conventions
- escapeHtml() for all DB output
- Relative paths (./) for GitHub Pages
- Mobile-first, 44pt touch targets
- clamp() for responsive text
- CSS variables for themes (data-theme attribute)

## Never Do
- Don't commit secrets/keys
- Don't modify RLS without explicit request
- Don't add cookies or visitor logging
- Don't break relative paths in manifest/HTML

---

# Skill Priority Matrix

When multiple skills could apply, use this order:

## 1. supabase (HIGHEST — always check first for DB/Backend tasks)
- Trigger: any Supabase table, Edge Function, Auth, Storage, RLS, migration
- Override: supabase-postgres-best-practices for low-level SQL/Postgres internals only

## 2. supabase-postgres-best-practices (for deep Postgres/SQL work)
- Trigger: schema changes, index design, query optimization, RLS policy authoring, EXPLAIN, connection pooling
- Note: supabase skill already covers most RLS rules — this is for advanced Postgres internals

## 3. responsive-design (for layout/adaptive work)
- Trigger: CSS Grid, Flexbox, breakpoints, fluid typography, container queries, mobile-first
- Note: takes priority over frontend-design for functional layout changes

## 4. accessibility (for WCAG/a11y work)
- Trigger: keyboard navigation, screen reader, contrast, ARIA, focus management, form labels
- Note: always run alongside responsive-design for layout changes

## 5. performance (for speed/optimization work)
- Trigger: Lighthouse audit, Core Web Vitals, loading speed, runtime optimization, caching
- Note: takes priority over best-practices for performance-specific tasks

## 6. best-practices (for security/compatibility/quality)
- Trigger: security audit, CSP, SRI, deprecated APIs, browser compatibility, code quality
- Note: overlaps with performance (defer scripts, event delegation) and accessibility (semantic HTML) — those sections are secondary here

## 7. frontend-design (for visual redesign only)
- Trigger: complete redesign, new visual identity, aesthetic overhaul, typography direction
- Note: LOW priority for functional changes. May conflict with performance (custom fonts vs system fonts) — defer to performance for font choices

## 8. seo (for search optimization)
- Trigger: meta tags, structured data, sitemap, robots.txt, canonical URLs, heading structure
- Note: overlaps with accessibility (alt text, semantic HTML) — those sections are secondary here

## 9. russian-compliance (for legal/regulatory work)
- Trigger: privacy, cookies, 152-ФЗ, 187-ФЗ, 150-ФЗ, 38-ФЗ, Roskomnadzor, blocking, fines, legal risks, BAD/supplement regulations, data localization
- Note: HIGH priority for any task touching personal data, analytics, cookies, advertising, or supplement sales

## 10. russian-ip-compliance (for ИП/sole proprietor work)
- Trigger: ИП taxes, УСН, ПСН, НПД, KKT, 54-ФЗ, 209-ФЗ, 152-ФЗ for ИП, safety (ОТ, ПБ), mandatory insurance, website obligations for ИП, INN/OGRNIP display, foreign bank accounts, payment systems
- Note: HIGH priority when working with ИП-specific requirements or when user mentions being an individual entrepreneur

## 11. webapp-testing (for verification/automation)
- Trigger: Playwright automation, browser testing, screenshot capture, console log inspection
- Note: use only when user explicitly asks for testing/verification

---

# Conflict Resolution Rules

When two skills give different advice:

1. **Performance vs Design**: Performance wins for production code. Use system fonts, defer scripts, lazy load. Only use custom fonts if user explicitly requests branding.

2. **Supabase vs Postgres-BP**: Supabase wins for Supabase-specific features (Auth, Edge Functions, Storage, dashboard). Postgres-BP wins for raw SQL, EXPLAIN, connection internals.

3. **Accessibility vs Responsive-Design**: Both apply. Accessibility adds constraints (min 24px targets, focus visible, semantic HTML). Responsive-Design handles layout. Don't sacrifice accessibility for layout.

4. **Best-Practices vs Performance**: Performance is more specific. Best-Practices is broader. If advice overlaps, use the more specific skill (performance).

5. **SEO vs Accessibility**: Both apply to alt text, headings, semantic HTML. They agree here — no conflict.

6. **Russian-Compliance vs Others**: Compliance overrides. If legal requirements conflict with design/performance/SEO — legal wins. Examples:
   - Google Analytics (SEO/performance) vs Яндекс.Метрика (compliance) → compliance wins
   - Custom fonts from Google Fonts (design/performance) → compliance wins, use system fonts or Russian CDN
   - WhatsApp link with PD transmission (UX) → compliance wins, sanitize data flow

## Default Skill Activation
- For general code changes: responsive-design + accessibility + best-practices
- For Supabase/Backend: supabase + supabase-postgres-best-practices
- For performance: performance (overrides best-practices overlap)
- For visual redesign: frontend-design (but defer to performance on fonts/loading)
- For SEO: seo (but defer to accessibility on alt text/headings)
- For legal/compliance: russian-compliance (overrides all other skills)

---

# Project-Specific Legal Risks (2026)

## Current Compliance Status: MOSTLY COMPLIANT

### ✅ What's Already Correct
- No cookies used — only localStorage (152-ФЗ compliant)
- No Google Analytics, Google Fonts, or foreign services
- No user PD collected (no names, phones, emails on frontend)
- Privacy Policy exists at privacy.html
- Product descriptions use neutral language (not medical claims)
- robots.txt blocks /admin/ (correct)
- Canonical URLs present
- No patient testimonials or medical claims in UI

### ⚠️ Active Risks to Monitor

**1. WhatsApp Order Flow (152-ФЗ risk)**
- create-order Edge Function sends order data to WhatsApp
- Phone number is transmitted — this is PD under 152-ФЗ
- Mitigation: Privacy Policy already states only phone is collected (line 81)
- Risk: LOW — but ensure no additional PD (names, addresses) are transmitted without consent

**2. Supabase as Foreign Service (152-ФЗ risk)**
- Supabase (US company) hosts database and Edge Functions
- User data (cart items, order analytics) stored on US servers
- Risk: MEDIUM — if Roskomnadzor determines this as cross-border PD transfer
- Mitigation: Currently no PD stored in Supabase (orders_analytics is anonymous — no names/phones)

**3. BAD Advertising Compliance (150-ФЗ risk)**
- Site sells biologically active supplements
- Since 09.2025: Rosconsumer can block sites without court decision
- Risk: MEDIUM — depends on product descriptions
- Mitigation: Ensure no medical claims, no "treats/cures" language, no patient testimonials
- Required: All products must have state registration in ЕАЭС registry

**4. Consent Document (152-ФЗ — 09.2025 update)**
- Since 01.09.2025: consent must be SEPARATE document
- Cookie banner is NOT valid consent under new rules
- Risk: LOW for this site — no PD processing requiring consent (only localStorage)
- Mitigation: If PD collection is added in future, create separate consent document

**5. Fines and Penalties**
- Art. 13.11 КоАП (152-ФЗ): up to 100k rubles for missing consent/privacy
- 150-ФЗ: IP 50-100k, legal entity 100-500k for unregistered BAD sales
- Art. 272.1 УК: up to 10 years for illegal PD use/transmission

---

# ФЛ (Physical Person) Requirements

## For This Site Owner (ФЛ, Not ИП)

### What's Required
- Privacy Policy (152-ФЗ compliant) — already exists at privacy.html
- No INN/OGRNIP display required (only for ИП)
- No KKT required (only for ИП with cash payments)
- No separate consent document needed (site doesn't collect PD — only localStorage)

### Tax Considerations
- If commercial activity: consider NPD registration (4% tax for ФЛ, limit 10M ₽)
- НДФЛ (13%) applies to undeclared commercial income
- Without registration: risk of being classified as undeclared entrepreneurship

### 152-ФЗ for ФЛ
- ФЛ is an operator if processes PD commercially
- Must have: Privacy Policy, consent to process PD (separate document since 09.2025)
- Cross-border transfer restrictions apply
- Fines: up to 100k rubles

### Prohibited for ФЛ
- Large-volume sales without tax registration (risk of ИП status)
- Foreign bank accounts for business income (since 2021)
- Anonymous commercial payments
- Activities requiring ИП or legal entity (pharmacy, alcohol, etc.)

## For This Site (JACK NUTRITION) — ФЛ Checklist
- [x] Privacy Policy exists (152-ФЗ compliant)
- [x] No INN/OGRNIP needed (ФЛ)
- [ ] If commercial: consider NPD registration (4% tax)
- [ ] No foreign payment systems for Russian clients
- [ ] All BADs must be state-registered in ЕАЭС
- [ ] No medical claims in product descriptions
- [ ] No patient testimonials
- [ ] Consent document if collecting PD (separate since 09.2025)