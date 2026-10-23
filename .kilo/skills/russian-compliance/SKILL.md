---
name: russian-compliance
description: Use for Russian legal compliance on websites — 152-ФЗ (personal data), 187-ФЗ (critical info infrastructure), 150-ФЗ (BAD regulation), 38-ФЗ (advertising), 149-ФZ (info tech). Trigger when asked about privacy, cookies, data processing, legal risks, Roskomnadzor, blocking, fines, or BAD/supplement sales compliance.
---
# Russian Legal Compliance for Websites

## Key Laws (2025-2026)

### 152-ФЗ — Personal Data (О персональных данных)
- Operator must have: Privacy Policy, consent to process PD, order appointing responsible person, regulations, logs
- Consent MUST be a SEPARATE document since 01.09.2025 (not in Cookie banner or User Agreement)
- Cross-border data transfer: prohibited to foreign services (Google Analytics, WhatsApp, Telegram, foreign SaaS/cloud) until data is first placed in Russia
- Roskomnadzor auto-checks sites for forbidden widgets/scripts since 01.07.2025
- Fines: Art. 13.11 КоАП — up to 100k rubles; criminal liability Art. 272.1 УК — up to 10 years

### 187-ФЗ — Critical Information Infrastructure
- Applies to sites critical to economy/security (finance, health, transport, gov)
- Small online stores: usually NOT classified as КИИ
- If classified: mandatory categorization, security assessment, interaction with НКЦКИ
- Foreign software banned on significant КИИ objects since 2024

### 150-ФЗ — BAD Regulation (Биологически активные добавки)
- Since 01.09.2025: Rosconsumer can BLOCK sites without court decision if they sell unregistered/forbidden BADs
- All BADs must have state registration in ЕАЭС unified registry
- No advertising that creates impression of medicinal properties
- No testimonials, no "treats/cures" claims, no pushing to refuse healthy diet
- Fines: IP 50-100k rubles, legal entities 100-500k rubles

### 38-ФЗ — Advertising
- Art. 25: special requirements for BAD advertising
- Forbidden: medical claims, patient testimonials, "buy instead of medicine"
- Must not push to refuse healthy nutrition

### 149-ФЗ — Information/IT/Info Protection
- Data localization requirements for certain categories
- "Маска" law for sites collecting PD

## Site Audit Checklist

### Must Have
- [ ] Privacy Policy (separate page, not in footer)
- [ ] Separate consent document for PD processing (since 09.2025)
- [ ] No Google Analytics, Google Fonts, reCAPTCHA, or other foreign services transferring data abroad
- [ ] No WhatsApp/Telegram links that transmit user data to foreign servers
- [ ] All BADs have state registration numbers in ЕАЭС registry
- [ ] No medical claims in product descriptions
- [ ] No patient testimonials or "treats/cures" language
- [ ] No claims pushing to refuse healthy diet
- [ ] Product descriptions use neutral language: "biologically active supplement", not "treatment"

### Must Avoid
- Google Analytics → replace with Яндекс.Метрика
- Google reCAPTCHA → replace with Russian analog or disable
- WhatsApp direct links → use without PD transmission
- Foreign SaaS/cloud → localize on Russian servers
- "Лечит", "избавляет", "спасает от" → forbidden words for BADs
- Patient reviews/cases → forbidden in BAD advertising
- "Вместо лекарств" → forbidden