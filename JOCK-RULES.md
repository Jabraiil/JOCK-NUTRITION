# JOCK-RULES — Design & Logic Ruleset

> **AGENT — READ THIS BLOCK FIRST.**
> This file is the project ruleset. **Do not overwrite `PROJECT_CONTEXT.md` or any existing project instructions.** Treat these rules as an **additional layer merged on top** of whatever rules already exist.
> Precedence: direct user request > JOCK-RULES > existing project defaults > model defaults. When a user request conflicts with a rule here, follow the user and name the rule ID you are overriding.
> Before writing any markup, run **§0**. Before returning any build, run **§9**.
> Acknowledge in one line: `JOCK-RULES active.`

Prescriptive ruleset for JOCK NUTRITION storefront and admin panel.
Source: production codebase analysis (`styles.css`, `app.js`, `admin/styles.css`, `admin/app.js`).

Compliance levels: **MUST NOT** = defect, ships broken. **MUST** = required. **SHOULD** = default, deviate only with a stated reason.

---

## §0 Workflow — run before writing any code

1. **Read the active files. MUST.** Before editing any file, read its current contents. Do not edit from memory.
2. **Emit tokens before markup. MUST.** Font stack, 3 colours, one easing curve, radius family, spacing scale. Print them as a list, then build.
3. **Use project patterns. MUST.** Follow existing JS helpers (`escapeHtml`, `fetchWithTimeout`, `debounce`), CSS custom properties, and component classes. Do not invent new abstractions without removing the old ones first.

**Delivery format. MUST:** keep existing file structure:
```
index.html   — storefront markup
styles.css   — storefront styles
app.js       — storefront logic
admin/
  index.html — admin markup
  styles.css — admin styles
  app.js     — admin logic
```

**MUST NOT:** Tailwind via CDN, CSS frameworks, inline `style=` in storefront markup (allowed only in `admin/` where it already exists).

---

## §1 Safety — critical invariants

**SAF-01 — MUST NOT** break server-side price validation. Client must never calculate `total` for checkout. The `create-order` Edge Function is the sole source of truth for prices, stock limits, and order numbering.

**SAF-02 — MUST NOT** introduce cookies, IP logging, or client-side personal data tables. The project has zero tracking by design.

**SAF-03 — MUST NOT** expose `service_role` key in frontend code. Only anon key is allowed in `app.js`.

**SAF-04 — MUST NOT** bypass `escapeHtml()` for any dynamic content in markup generation. Every `product.name`, `product.description`, user input, and DB-derived string must pass through `escapeHtml()`.

**SAF-05 — MUST** preserve localStorage key namespace. Storefront user-data keys must start with `jock-` (`jock-cart`, `jock-favorites`, `jock-theme`, `jock-cookie-consent`, `jock-welcome-shown`, `jock-visit-count`, `jock-pwa-install-attempt`). Admin auth keys are exempt: `admin-token`, `admin-refresh-token`. Do not add new keys without the prefix unless they are admin auth tokens.

**SAF-06 — MUST NOT** remove or alter `prefers-reduced-motion: reduce` handler. It must collapse all animation durations and disable scroll-behavior smooth.

**SAF-07 — MUST NOT** break the barcode scanner fallback chain: `BarcodeDetector` API → camera stream → Web Worker (`scanner-worker.js`) → manual input. If any layer fails, the next must activate automatically.

**SAF-08 — MUST NOT** change checkout flow without updating Edge Function contract. Request body is `{ cart, whatsappAccountType }`. Response must contain `whatsappUrl` or `error` + HTTP status.

---

## §2 Design System — iOS-style, mobile-first

**DS-01 — MUST** use system font stack exclusively. No web fonts, no Google Fonts, no `@font-face`.

```css
--font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
        "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
--font-mono: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace;
```

**DS-02 — MUST** use only these colour tokens. Do not invent new hues.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--bg` | #F2F2F7 | #000000 | Page background |
| `--bg-elevated` | #FFFFFF | #1C1C1E | Cards, drawers, modals |
| `--text` | #1C1C1E | #FFFFFF | Primary text |
| `--text-secondary` | #8E8E93 | #AEAEB2 | Secondary text |
| `--border` | #E5E5EA | #38383A | Dividers, borders |
| `--primary` | #007AFF | #0A84FF | CTA, active states |
| `--primary-hover` | #0A6AE0 | #409CFF | Primary hover |
| `--accent` | #FF9500 | #FF9500 | Badges, highlights |
| `--success` | #34C759 | #34C759 | In stock, success |
| `--error` | #FF3B30 | #FF3B30 | Out of stock, danger |

**DS-03 — MUST** use these radius tokens only.

| Token | Value |
|-------|-------|
| `--radius-sm` | 10px |
| `--radius-md` | 14px |
| `--radius-lg` | 20px |

**DS-04 — MUST** use these spacing/sizing tokens.

| Token | Value | Role |
|-------|-------|------|
| `--touch` | 44px | Minimum touch target |
| `--header-height` | 56px (storefront) / 64px (admin) | Header height |
| `--container-max` | 1200px (1400px on >1600px) | Max content width |

**DS-05 — MUST** use `clamp()` for all responsive typography and spacing. Never hardcode `px` for font sizes in storefront.

```css
font-size: clamp(0.95rem, 0.9rem + 0.2vw, 1.05rem);
```

**DS-06 — MUST** apply `text-wrap: balance` on headings and `text-wrap: pretty` on body copy. Already handled in storefront typography.

**DS-07 — SHOULD** express weight through size, not boldness. Display type stays at 400–700, never 900.

**DS-08 — MUST NOT** use gradients as decorative backgrounds in the storefront. Gradients are allowed only in admin auth page and sidebar header as subtle accents.

**DS-09 — MUST** use `cubic-bezier(0.32, 0.72, 0, 1)` for all drawer/modal transitions in both storefront and admin. This is the project easing curve.

**DS-10 — MUST** use `#007AFF` / `#0A84FF` as storefront primary. Admin may use `#0071E3` / `#0077ED` as a distinct but adjacent blue. Do not mix them within one interface.

---

## §3 Components — storefront

**CMP-01 — MUST** keep the catalog as CSS Grid with responsive columns:
- `<480px`: 2 columns
- `≥768px`: 3 columns
- `≥1024px`: 4 columns
- `≥1200px`: 5 columns
- `≥1600px`: 6 columns

**CMP-02 — MUST** render product cards with this structure:
- `.product-card` → `.product-image-wrap` (aspect-ratio: 3/4) → `.product-info` → `.product-footer`
- Card border: `1px solid var(--border)`, radius: `14px`
- Image `object-fit: contain` on `--bg` background

**CMP-03 — MUST** use iOS-style bottom navigation bar (floating dock):
- `position: fixed; bottom: 0; max-width: 420px; margin: 0 auto;`
- `backdrop-filter: blur(12px)`, border-radius: 24px
- 4 items: Catalog, Search, Favorites, Cart
- Labels hidden on mobile (`font-size: 0`), visible on `≥768px`

**CMP-04 — MUST** implement modals as bottom sheets on mobile (`<768px`), centered popups on desktop:
- Mobile: `align-items: flex-end`, `border-radius: var(--radius-lg) var(--radius-lg) 0 0`
- Desktop: `align-items: center`, `border-radius: var(--radius-lg)`

**CMP-05 — MUST** implement drawers (filters, cart) with `transform: translateX(±100%)` on mobile, centered modal on desktop (`≥768px`).

**CMP-06 — MUST** show skeleton screens during initial load. Use `.skeleton-card` with shimmer animation. Do not show raw `Загрузка...` text as primary loading state.

**CMP-07 — MUST** use `data-id` attributes for product IDs in markup. IDs are UUIDs from Supabase.

**CMP-08 — MUST** use event delegation for catalog clicks (`.catalog` listener) and cart item clicks (`#cartItems` listener). Do not attach individual listeners to every card.

**CMP-09 — MUST** use `loading="lazy"` and `decoding="async"` on all product images. Provide `width` and `height` attributes.

**CMP-10 — SHOULD** use `content-visibility: auto` on product cards for performance.

**CMP-11 — MUST** disable promo banner autoplay on mobile (`<768px`). Autoplay runs only on desktop. Pause button must reflect state correctly.

**CMP-12 — MUST** use `inert` attribute on inactive banner slides for accessibility. Remove `inert` only from active slide.

**CMP-13 — MUST** hide promo banner when `favoritesOnly` is active. Show it again when returning to catalog.

---

## §4 Components — admin

**ADM-01 — MUST** keep sidebar layout: fixed sidebar (`260px`) + main content with `margin-left: var(--sidebar-width)`. On mobile (`≤768px`), sidebar becomes overlay with hamburger toggle.

**ADM-02 — MUST** use inline SVGs for all icons in admin navigation. Do not use icon fonts or emoji as primary icons.

**ADM-03 — MUST** use `.nav-item` with `::before` pseudo-element for active indicator (3px left border, height 60%, primary colour).

**ADM-04 — MUST** use `.data-table` for all tabular data. Zebra striping is not required; use borders and hover states instead.

**ADM-05 — MUST** implement CRUD modals as centered popups (same as storefront desktop behaviour).

**ADM-06 — MUST** use `field-hint` spans with `?` for tooltips. Tooltip text must explain the field purpose in one short sentence.

**ADM-07 — MUST** use `.toggle-switch` for boolean settings (visibility, time limits, stock display).

**ADM-08 — MUST** show monitor indicator in header with polling `create-order/health` every 30s. Green dot = active, grey = error.

---

## §5 JavaScript Patterns

**JS-01 — MUST** use `CONFIG` object at top of every JS file for external URLs and keys.

```js
const CONFIG = {
    supabaseUrl: 'https://hpphfeojjejculvdundj.supabase.co',
    supabaseAnonKey: 'sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1',
    orderFunctionUrl: 'https://.../functions/v1/create-order',
    adminApiUrl: 'https://.../functions/v1/admin-api'
}
```

**JS-02 — MUST** use `fetchWithTimeout(url, options, timeout = 15000)` for all network requests. Do not use raw `fetch()`.

**JS-03 — MUST** use `escapeHtml(str)` for all dynamic strings inserted into `innerHTML`. Never concatenate raw DB values into HTML.

**JS-04 — MUST** use `debounce(func, wait)` for search inputs (300ms) and price filters (500ms).

**JS-05 — MUST** use API cache with TTL for products (30s), related (60s), categories/brands (60s).

**JS-06 — MUST** wrap all `localStorage` access in `try/catch`. Feature-detect with `if ('localStorage' in window)`.

**JS-07 — MUST** use `data-*` attributes for DOM-to-JS hooks. IDs are for unique elements; `data-id` for product UUIDs.

**JS-08 — MUST NOT** use `alert()` for user-facing errors in new code. Use `showError()` or dedicated error elements.

**JS-09 — MUST** initialize once with `initialized` guard flag. Do not re-run `init()` on every navigation.

**JS-10 — MUST** clean up barcode scanner resources in `closeBarcodeScanner()`: cancel `rafId`, terminate worker, stop media tracks, reset state variables.

**JS-11 — MUST** use `navigator.vibrate(200)` on scan success and cart add/remove (if available).

**JS-12 — MUST** use `Intl.DateTimeFormat` with explicit `timeZone` for all time-based logic. Never use local time for order time limits.

**JS-13 — MUST** use `Promise.allSettled` or sequential fallback when loading multiple independent resources (categories + brands).

**JS-14 — SHOULD** use `WeakSet` for initialized slider tracks to avoid duplicate bindings.

**JS-15 — MUST** register Service Worker (`sw.js`) only on storefront, not on `/admin/`. Use `SKIP_WAITING` message and `controllerchange` listener for updates.

**JS-16 — MUST** implement A2HS (Add to Home Screen) with both `beforeinstallprompt` and iOS Safari fallback (`setTimeout` on second visit). Track installs with `jock-pwa-install-attempt` and visit count with `jock-visit-count`.

**JS-17 — MUST** detect offline/online status and show message in `#error` element. Do not block the app when offline; cart and favorites still work.

**JS-18 — MUST** translate all Supabase/PostgreSQL errors to Russian in admin using `translateError()` before showing to user.

**JS-19 — MUST** handle `401` globally in admin `fetchWithTimeout()` by calling `handleAuthError()` and returning to login screen.

**JS-20 — MUST** use admin barcode scanner fallback chain: `Html5Qrcode` → camera → manual input. Admin scanner state variables must be prefixed with `admin` (`adminBarcodeStream`, `adminScannerWorker`, etc.).

---

## §6 Bans

**The notification card — MUST NOT.** White rectangle + grey border + soft shadow + coloured strip on the left. This is the most common AI-generated UI pattern.

**Blue-to-violet gradients — MUST NOT.** Highest-frequency AI marker. Gradients are banned in storefront entirely.

**`·` and `•` as separators — MUST NOT.** Use `/` or whitespace only.

**Keyboard glyphs and emoji in the storefront interface — MUST NOT.** Use Lucide-style inline SVGs. Admin panel may use emoji only where it already exists (`🤖`, `👁️`, `👁️‍🗨️`, `🗑️`, `✕`, `📁`, `?`). Do not add new emoji to admin.

**Fill + visible border on one element — MUST NOT.** A filled button must have no border. A bordered button must have no fill.

**The same flat `box-shadow` repeated on every block — MUST NOT.** Vary shadow intensity by elevation level.

**Tracked-out uppercase headings — MUST NOT.** No `letter-spacing: 0.2em` on headings.

**Inline `style=` in storefront markup — MUST NOT.** Use CSS classes. Inline styles are permitted only in `admin/` where they already exist (e.g., table column widths, conditional `display:none`).

**A single word orphaned on a line — MUST NOT.** Use `&nbsp;` for short RU words: `в, на, с, к, у, о, и, а, но, из, за, по, до, от`.

**Pastel backgrounds. More than 3 colours — MUST NOT.** Storefront uses iOS system colours only.

---

## §7 Typography

**TYP-01 — MUST** use system font stack only. No web fonts.

**TYP-02 — MUST** use `clamp()` for all font sizes in storefront.

**TYP-03 — MUST** set `line-height: 1.5` on body. Headings may go down to `1.2–1.35`.

**TYP-04 — MUST** use `letter-spacing: -0.02em` on large headings, `0.06em` uppercase on small labels.

**TYP-05 — MUST** use `text-wrap: balance` on headings, `text-wrap: pretty` on body.

**TYP-06 — MUST** clamp product name to 2 lines with `-webkit-line-clamp: 2`.

**TYP-07 — MUST** use uppercase, small size (`clamp(0.65rem, 1.8vw, 0.78rem)`), increased tracking for brand labels on cards.

---

## §8 Imagery

**IMG-01 — MUST** use `aspect-ratio: 3/4` for product photos in catalog. `object-fit: contain` on `--bg` background.

**IMG-02 — MUST** use `aspect-ratio: 2.2/1` for promo banner on desktop, `1.6/1` on mobile.

**IMG-03 — MUST** add dark gradient overlay on promo banner for text legibility:
```css
background: linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.05) 100%);
```

**IMG-04 — MUST** use `loading="lazy"` and `decoding="async"` on all below-fold images.

**IMG-05 — MUST** provide `width` and `height` attributes on all product images to prevent layout shift.

**IMG-06 — MUST** use SVG fallback `data:image/svg+xml` when product has no images.

---

## §9 Acceptance — run before returning any build

```
[ ] SAF-01  Server-side prices never calculated client-side
[ ] SAF-04  All dynamic HTML passes through escapeHtml()
[ ] SAF-06  prefers-reduced-motion handler present and functional
[ ] SAF-07  Barcode scanner fallback chain intact
[ ] DS-01   Font stack is system-only, no web fonts
[ ] DS-02   Colours use project tokens only
[ ] DS-05   Typography and spacing use clamp()
[ ] DS-09   Easing curve is cubic-bezier(0.32, 0.72, 0, 1)
[ ] CMP-01  Catalog grid matches breakpoint spec
[ ] CMP-02  Product card structure matches spec
[ ] CMP-03  Bottom nav is floating dock, max-width 420px
[ ] CMP-06  Skeleton screens shown during initial load
[ ] CMP-07  Product IDs use data-id attributes
[ ] CMP-08  Event delegation used for catalog/cart
[ ] CMP-09  Images have loading="lazy", decoding="async", width, height
[ ] CMP-11  Banner autoplay disabled on mobile (<768px)
[ ] CMP-12  Inactive banner slides have inert attribute
[ ] ADM-01  Admin sidebar is fixed 260px + margin-left on desktop
[ ] ADM-02  Admin icons are inline SVGs
[ ] ADM-06  Admin tooltips use field-hint spans
[ ] ADM-08  Monitor indicator present with health polling
[ ] JS-02   All fetch calls use fetchWithTimeout()
[ ] JS-06   localStorage wrapped in try/catch
[ ] JS-10   Scanner resources cleaned up on close
[ ] JS-15   Service Worker registered only on storefront
[ ] JS-18   Admin errors translated via translateError()
[ ] JS-19   Admin 401 triggers handleAuthError()
[ ] §6      No notification cards, no blue-to-violet gradients, no inline styles in storefront
[ ] Content Every number and label proofread at 100% zoom
```

---

## §10 Numeric reference

| Parameter | Value |
|-----------|-------|
| Touch target | 44px |
| Storefront header height | 56px |
| Admin header height | 64px |
| Admin sidebar width | 260px |
| Container max | 1200px (1400px on >1600px) |
| Bottom nav max-width | 420px |
| Products per page | 20 |
| Orders per page | 50 |
| Search debounce | 300ms |
| Price filter debounce | 500ms |
| Request timeout | 15000ms |
| API cache TTL (products) | 30000ms |
| API cache TTL (filters/related) | 60000ms |
| Scanner interval | 250ms |
| Banner autoplay | 5000ms |
| Banner min-width for autoplay | 768px |
| Easing curve | cubic-bezier(0.32, 0.72, 0, 1) |
| LocalStorage keys | `jock-cart`, `jock-favorites`, `jock-theme`, `jock-cookie-consent`, `jock-welcome-shown`, `jock-visit-count`, `jock-pwa-install-attempt` |
| Admin auth keys | `admin-token`, `admin-refresh-token` |
| Safe-area inset | `env(safe-area-inset-top/bottom)` |

---

## §11 File inventory

| File | Role |
|------|------|
| `index.html` | Storefront markup, PWA meta, structured data |
| `styles.css` | Storefront iOS-style CSS |
| `app.js` | Storefront logic, cart, scanner, banner |
| `scanner-worker.js` | Barcode detection Web Worker |
| `sw.js` | Service Worker, versioned cache |
| `manifest.json` | PWA manifest |
| `admin/index.html` | Admin panel markup |
| `admin/styles.css` | Admin panel CSS |
| `admin/app.js` | Admin panel logic, auth, CRUD, analytics |

---

Full system — source of truth is the codebase itself. When in doubt, read the existing files before writing.
