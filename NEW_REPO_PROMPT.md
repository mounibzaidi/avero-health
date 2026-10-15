# Prompt for the new repo

Paste everything below the line into Claude Code, started in the new empty folder. The folder `../carryover/` must sit next to it.

---

You are starting a **new repo** for a clinical protocols product: **Algerian GPs and interns** read official guidelines turned into structured **fiches**, with **verbatim sourced quotes**, **DCI doses** and **Algerian brands** from the national nomenclature.

- **Clients:** one Expo app (iOS, Android and web) for doctors, and an **admin dashboard** to create, edit, review and publish fiches.
- **Crawler:** collects the source guidelines.

An older repo was audited and packaged in `../carryover/`. **Do not write any code first.**

## Step 0: read, then propose a plan (no coding)

Read these in order:

1. `../carryover/AUDIT.md`: the stack in use, the folder map, every fiche shape and how they disagree, the fiches that exist, and a keep/rewrite/drop table.
2. `../carryover/PRESERVE.md`: the 5 parts to carry over, with exact files, wiring, what must not be lost and what to fix.
3. `../carryover/DESIGN_SYSTEM.md` and `../carryover/design-tokens.json`: every token, extracted from code.
4. `../carryover/SCREENS.md` and `../carryover/screenshots/`: the fiche screens on phone (390) and desktop (1440), the dashboard and the editor.
5. `../carryover/FORMAT_MAPPING.md`: **the final mapping**, i.e. numbered storage → v4 screen blocks, the schema additions, and the conversion check of stroke, ACS and eclampsia (the 8 lines that do not fit). Also `../carryover/conversion_check/` (converter, verifier, outputs, `report.txt`).
6. `../carryover/QUESTIONS.md`: open decisions. Q1, Q2, Q3, Q7 and Q20 are answered below; do not resolve the others yourself.
7. `../carryover/code/`: copies of the old files, at their old relative paths. Also `code/docs/fiche-protocole.SKILL.md` (the agreed fiche format), `code/docs/SCHEMA.md` (numbered schema v1 and its validation rules) and `code/docs/PROTOCOL_TEMPLATE.md` (v4, newer screen).
8. `../carryover/content/`: the existing fiches as data (stroke and ACS are the references).

The old repo's uncommitted work is saved on its branch `v4-wip` (commit `b37dca1`). Treat the old repo as read-only.

## Decisions already made (from the owner, 2026-10-14)

| # | Topic | Decision |
|---|---|---|
| D1 | Storage format | **Decided.** **Store in the numbered schema only.** v4 is **display only**, through the mapping table in FORMAT_MAPPING.md §2 (numbered section → v4 screen block). **No v4 storage format** in the new repo. The **4-item cap is a display rule** (show 4, then "Voir plus"), never a data limit. Schema additions are below (`posologie.id`, `element.attached_to`, `element.delai`, `9_orientation` `phase`, `2_presentation.criteres_diagnostiques` + `diagnostics_differentiels`, `11_suivi.conseils_patient`). No Cas particuliers section: population lines are elements with `condition` in their own section. Red limits on a closed dose card are derived (no field). Infusion switches use `condition` + `conflict_group` (open point Q22). |
| D2 | Editor | **v4 editor layout** (`code/dashboard/app/(staff)/protocole/[id]/page.tsx`: PDF beside the form, quote highlight, read-first items, one-at-a-time editing, paste JSON, "Vérifier les citations") **with the numbered editor's fields** (`code/_runner_up/dashboard/app/(staff)/protocoles/[topic]/[id]/page.tsx`: type, risk, origin, condition, grade, cells, dose fields, `checked` review of risk-high lines, per-element findings). Fields follow the schema below. |
| D3 | Section 12 and `decision_initiale` | Section **12 (ordonnance) is in the urgence schema and display**; when its state is `sans_objet` it is hidden. **`decision_initiale` exists for urgence only**: a pathologie fiche must not have it. |
| D4 | Backend | **A small Python service** (crawler + PDF quote-on-page check + brand matcher) **plus Supabase**. **Do not rewrite the Python in TypeScript.** Its `requirements.txt` must list **`pypdf`** and **`PyYAML`** (both imported by the old code but missing from its requirements). |
| D5 | Dashboard | **Stays Next.js.** "Expo for everything" means the GP-facing app only; the dashboard is an internal tool and the PDF highlighting needs the browser. |
| D6 | Known broken ref | Stroke (`content/protocols/stroke/e61174cfe7/v0001.json`) points to a sibling fiche **`avc-thrombolyse` that does not exist**: in `meta.siblings` and in the `7_traitement` line "voir fiche avc-thrombolyse". The import must turn it into a ref, and the validator **must report it as a missing ref** (publish blocked) instead of dropping it silently. Use it as a test case. |

Then reply with:

- (a) your understanding in 10 lines;
- (b) the answers you still need (Q21 to Q26 before the schema step, then Q4, Q6, Q8 to Q19 as each step reaches them);
- (c) a numbered plan following "Build order" below, each step small and runnable, with how you will check it.

**Wait for my go before writing code.**

## Hard rules

1. **Never write clinical content from your own knowledge.** No doses, thresholds, drug names, durations, indications, contraindications or quotes, not even as examples, placeholders, seed data or test fixtures. Clinical text comes only from `../carryover/content/` or from what I give you. Tests use obviously fake strings (`"Ligne de test A"`, `"Citation de test p.1"`).
2. **French UI.** All user-facing strings are in French. Take wording from `code/app/src/strings/fr.ts` when a string already exists. No English or Arabic UI unless I ask (Q14).
3. **No em dashes (—) in UI copy.** Use a colon, a comma, parentheses or " · ".
4. **Reproduce the design system and the screen layouts faithfully. Do not redesign.** Same tokens, radii, shadows, type sizes, icons, card anatomy, section order and interactions as the carryover code and screenshots. When a token is inconsistent (DESIGN_SYSTEM.md §10), use the "latest" value given there and list what you unified.
5. **No new technology without asking.** The stack below is locked. Zod is approved. Anything else (including a test runner for TS, see below) needs my OK first.
6. Never print or commit secrets. Env files hold names only in `.env.example`.
7. Never call paid LLM APIs. The product does not need an LLM for this build.
8. Small commits only when I ask.

## Stack: one choice per concern, all already proven in the old repo

| Concern | Choice | Why |
|---|---|---|
| Monorepo | **npm workspaces**: `apps/mobile`, `apps/dashboard`, `packages/schema`, `packages/ui-tokens`, plus `services/api` (Python) and `services/crawler` (Python) | npm and lockfiles were used in both JS apps; no new tool |
| App (mobile and web) | **Expo SDK 57 + expo-router 57 + React Native 0.86 + react-native-web** (versions in `code/app/package.json`) | runs today on web and native; routes in `src/app` |
| Dashboard | **Next.js 16 App Router + React 19 + Tailwind 4** (as in `code/dashboard/package.json`) | decided (D5): internal tool, react-pdf quote highlighting needs the browser |
| Styling | **NativeWind 4 + Tailwind 3** in the app (CSS-variable tokens); Tailwind 4 in the dashboard; both read `packages/ui-tokens` | the tokens already work this way |
| State | **TanStack Query 5** for server and cached data + React local state; **AsyncStorage** for the offline library, favourites, recents and theme | as in `lib/fiches.ts` |
| Data, DB, storage | **Supabase** (Postgres, `fiche_versions` jsonb snapshots, the `published_fiches` view, the Storage bucket `sources` for PDFs) | migrations 0011 and 0013 in `code/backend/migrations/` |
| Auth | **Supabase Auth**; staff roles in a `staff` table (`admin`, `relecteur`) | as in the old dashboard (Q16) |
| Server logic | **FastAPI (Python)** in `services/api`: PDF text and the quote-on-page check (pypdf), the brand matcher, and starting crawler jobs. `requirements.txt` includes **pypdf** and **PyYAML** | decided (D4); port the existing Python (`verify.py`, `register.py`, `dz_brands.py`), never rewrite it in TS |
| Crawler | **Python + Crawl4AI 0.9.4 + httpx + BeautifulSoup**, its own venv, all requests through `polite.py` | carry `code/scraper/` over |
| Validation | **Zod** in `packages/schema`: the single source of truth, also exported as JSON Schema for Python | requested; it replaces three hand-copied type sets |
| Tests | **pytest** for Python (exists). For TS: **ask me before adding a runner**; my proposal is Vitest | there were no TS tests in the old repo |
| Icons | **phosphor-react-native** (per-icon imports) | as in `Icons.tsx` |
| Fonts | **Inter 400/500/600/700** (+ IBM Plex Sans Arabic only if Q14 keeps Arabic), **bundled** with expo-font for native and self-hosted for web; mono = platform mono stack | fixes "bold not loaded" and "no fonts on native" |

## Port these carryover files (and only these, unless I agree)

### 1. Design system → `packages/ui-tokens` + `apps/mobile/src/ui`

- `code/app/src/lib/theme.tsx`, `code/app/tailwind.config.js`, `code/app/global.css`
- `code/app/src/components/ui.tsx`, `code/app/src/components/Icons.tsx`
- `design-tokens.json`, `DESIGN_SYSTEM.md`

### 2. Fiche screens → `apps/mobile`

- **Layout shell, phone and wide:** `code/app/src/components/ProtocolV4.tsx` (jump bar, sidebar 264 + content 860 + source column 340 from 1100 px, the cards: `Card`, `Rows`, but showing **4** then "Voir plus (N)" (D1), `RedBox`, `Dose`, `Openers`, `Segments`, `Paper`, `ActionButton`, `Checklist`, `Exams`, `Referrals`, `TransferCard`).
- **Patterns for collapsed sections and decisions:** `code/app/src/components/Protocol.tsx` (numbered step cards with one open at a time and "Fermer" at the foot, `Branches` "Si … →", `DoseTable`, escalation cards, glance card, "À vérifier avant d'agir" box, conflict card).
- **Shared:** from `code/app/src/components/Fiches.tsx` take only `SourceSheet`, `SourceCard`, `StarButton`, `SearchField`, `Logo`/`LogoMark`, `Badge`, `ReviewBadge`, `ProtocolRow`, `TabBar`, `LibraryHome`, `Favorites`. Split them into their own files and **do not port the Guideline v2 renderer** (`FicheBody`, `ProtocolPage`, `SectionV2`…).
- **Also:** `Home.tsx`, `TopBar.tsx`, `Medicaments.tsx`, `PdfReader.tsx`, `PdfFrame.tsx`, `PdfFrame.web.tsx`, `lib/pdfHtml.ts`, `lib/fiches.ts` (offline sync, search with synonyms and typos, favourites, recents), `lib/brands.ts` + `register_rules.json` + `search-synonyms.json`, `lib/localRefs.ts`.
- **Routes** in `code/app/src/app/(app)/(library)/`.
- Use the **final mapping in FORMAT_MAPPING.md §2** (block order, component per numbered path, visible or collapsed per template) to render the numbered sections with these components. It supersedes SCREENS.md §D.

### 3. Crawler → `services/crawler`

- `code/scraper/*` and `code/shared/{sources,topics,documents,register_rules}.yaml`, `search-synonyms.json`.
- Fix the README contradictions listed in PRESERVE.md.

### 4. Dashboard (latest only) → `apps/dashboard`

- **Shell:** `code/dashboard/app/{layout.tsx,globals.css,page.tsx,login/page.tsx}`, `app/(staff)/layout.tsx`, `components/ui.tsx`, `lib/{api,auth,supabase,labels,normalise}.ts(x)`.
- **Protocoles hub:** `app/(staff)/protocoles/page.tsx` + `components/ProtocolCard.tsx` (checks card, completeness bar, publish gate).
- **Crawler UI:** `app/(staff)/collecte/**`, `components/{TopicSources,TopicList,Pipeline}.tsx`.
- **Do not port** Thèmes, Review or Méthode expérimentale (Q6).

### 5. Editor (latest only) → `apps/dashboard/app/(staff)/fiche/[id]` (decided: D2)

- **Base:** `code/dashboard/app/(staff)/protocole/[id]/page.tsx` + `components/PdfViewer.tsx`. Keep: PDF beside the form, quote highlight with "used" quotes in a second colour, read-first items with one-at-a-time editing, "obligatoire" quote markers, paste-JSON creation, "Vérifier les citations".
- **Numbered-schema fields:** from `_runner_up/dashboard/app/(staff)/protocoles/[topic]/[id]/page.tsx` (element type, risk, origin, condition, grade, cells, dose fields, the "checked" review of risk-high elements, per-element findings). The final field list waits for D1.

### Validation logic to port into `packages/schema` (TS) and `services/api` (quote check)

- `code/backend/factory/protocol_v1.py` (rules 1 to 8, exam terms only in 6, "ne pas" only in 8, risk-high rules, duplicate ids and texts)
- `code/backend/factory/protocol_v4.py` (coverage, list lengths, molecules in the register, staleness)
- `code/backend/factory/verify.py` (quote on the cited page, every number of the line in its quote)
- `code/backend/factory/register.py` + `code/backend/scripts/dz_brands.py` (strict brand match: DCI + form for route + strength rule; the nomenclature import)
- `code/backend/tests/test_protocol_v1.py` and `test_protocol_v4.py`: re-express the rules as tests with fake text

### Content to import → seed or migration scripts (no hand edits)

- `content/protocols/**` and `content/shared/dz_brands.json`. Import sources: stroke `protocols/stroke/e61174cfe7/v0001.json` and ACS `protocols/acs/32b53e31a1/v0001.json` (numbered). For eclampsia, the choice between `as_given.json` (numbered) and the v4 draft `eclampsie.json` is still Q8. **Never import the old v4 drafts `avc.json` and `sca.json`**: they lost content (FORMAT_MAPPING.md §6). Start from the converter and verifier in `../carryover/conversion_check/convert.py` and its `report.txt`. The import must surface the broken stroke → `avc-thrombolyse` ref (D6) and list every line that does not fit, as that report does.

## The fiche schema (`packages/schema`, Zod + inferred TS)

> **Decided (D1).** Implement this. Items marked `// CONFIRM` stay as written until the linked question is answered.

Base: the **real current schema**, i.e. the agreed `fiche-protocole` skill format (`code/docs/fiche-protocole.SKILL.md`, example `content/protocols/eclampsia/220e69e1/as_given.json`), whose stored form and rules are PROTOCOL SCHEMA v1 (`code/docs/SCHEMA.md`, `code/backend/factory/protocol_v1.py`).

Upgrades are marked `// NEW`. Anything marked `// CONFIRM` is my reading of an ambiguity in QUESTIONS.md. Keep it as written until I answer, and do not invent alternatives.

```ts
import { z } from "zod";

export const SectionState = z.enum(["filled", "non_traité", "sans_objet"]);
export const Template = z.enum(["urgence", "pathologie"]);
export const Risk = z.enum(["high", "medium", "low"]);
export const Origin = z.enum(["explicit", "local_adaptation"]);
export const ElementType = z.enum(["action", "conditional", "info", "row"]);

/** Page = printed page number of the document, not the PDF index (skill rule 2). */
export const SourceRef = z.object({
  source_id: z.string().min(1),
  page: z.number().int().min(1),
  page_end: z.number().int().min(1).optional(),
  quote: z.string().min(1),                       // verbatim
});

/** IDs only; labels are resolved at render. Element ids, S-xxx scores, F-xxx fiches techniques. */
export const RefId = z.string().min(1);           // CONFIRM Q11: allowed targets

export const Element = z.object({
  id: z.string().min(1),
  text: z.string().min(1),                        // French
  type: ElementType,
  condition: z.string().nullable(),               // required when type = conditional
  order: z.number().int().nullable(),
  timing: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  cells: z.record(z.string(), z.string()).optional(), // type = row: {signe, description} | {element, evoque} | {examen, seuil, interpretation}
  source: SourceRef,                              // REQUIRED on every element (rule: no element without quote + page). CONFIRM Q21 for local_adaptation
  translated: z.boolean(),
  grade: z.string().nullable(),                   // as written in the source
  risk: Risk,
  origin: Origin,
  reviewer: z.string().nullable().optional(),     // local_adaptation: who wrote it
  conflict_group: z.string().nullable(),
  missing: z.array(z.string()),
  checked: z.object({ by: z.string(), at: z.string() }).optional(), // risk-high reviewed individually
  refs: z.array(RefId).default([]),               // NEW
  attached_to: z.string().nullable().default(null), // NEW: a posologie id; overdose, antidote and dose-detail lines shown under their drug. CONFIRM Q23 (one id vs list)
  delai: z.enum(["immédiat", "<1h", "<24h"]).nullable().default(null), // NEW: rendered as the delay badge
  phase: z.enum(["avant_transfert", "pendant_transfert"]).nullable().optional(), // NEW: 9_orientation only (validator)
});

const Block = z.object({ state: SectionState, elements: z.array(Element) });

export const Titration = z.object({               // NEW: every field is source text, never computed
  start: z.string().nullable(),
  step: z.string().nullable(),
  interval: z.string().nullable(),
  max: z.string().nullable(),
});

export const AlgerieStatut = z.enum(["Enregistré", "Non renouvelé", "Retiré", "Aucune présentation enregistrée"]); // CONFIRM Q15
export const Posologie = z.object({
  id: z.string().min(1),                          // NEW (decided): target of attached_to and refs
  drug_dci: z.string().min(1),
  dose: z.string().min(1),
  dose_max: z.string().nullable(),
  route: z.string(),
  administration: z.string().nullable(),
  frequency_or_duration: z.string(),
  condition: z.string().nullable(),
  risk: Risk,                                     // always "high" (rule 7)
  source: SourceRef,
  translated: z.boolean(),
  missing: z.array(z.string()),                   // dose fields the source does not give: never invented
  titration: Titration.nullable().default(null),  // NEW
  algerie: z.object({ brands: z.array(z.object({ brand: z.string(), form: z.string(), dosage: z.string(), hospital: z.boolean() })), statut: AlgerieStatut.nullable() }), // computed by the matcher, never typed by hand
  note: z.string().nullable(),                    // source inconsistencies, flagged not fixed
  // CONFIRM Q24: add checked { by, at } (rule 7 review record; 7 ACS doses carry one today)
});

export const Sections = z.object({
  "1_essentiel": Block,                           // max 3 elements
  "2_presentation": z.object({
    state: SectionState,
    signes_typiques: z.array(Element),
    formes_trompeuses: z.array(Element),
    examen_clinique: z.array(Element),
    criteres_diagnostiques: z.array(Element).default([]),     // NEW: "Critères diagnostiques"
    diagnostics_differentiels: z.array(Element).default([]),  // NEW: rendered as "Penser aussi à"
  }),
  "3_champ": Block,
  "4_gravite": z.object({
    state: SectionState,
    decision_initiale: Block.optional(),          // NEW { state, elements[] }. Urgence only (D3): present on urgence (may be non_traité), forbidden on pathologie. CONFIRM Q9 (element kind, max lines)
    signes_de_gravite: z.array(Element),
    gestes_immediats: Block,
  }),
  "5_conduite": z.object({ state: SectionState, nodes: z.array(z.object({ node: z.string().min(1), branches: z.array(Element) })) }),
  "6_examens": Block,
  "7_traitement": z.object({ state: SectionState, elements: z.array(Element), contre_indications: Block, posologies: z.array(Posologie) }),
  "8_ne_pas_faire": Block,
  "9_orientation": Block,
  "10_surveillance": Block,
  "11_suivi": z.object({ state: SectionState, elements: z.array(Element), conseils_patient: z.array(Element).default([]) }), // NEW conseils_patient: "À dire au patient"
  "12_ordonnance": Block,                         // both templates (D3); hidden when sans_objet
  "13_definitions": Block,
});

// CONFIRM Q26: url, origine, pagination (and meta cim10, synonymes) have no field yet
export const SourceMeta = z.object({
  source_id: z.string().min(1),
  type: z.enum(["full_guideline", "synthesis", "update_only", "product_info"]),
  title: z.string().min(1),
  citation: z.string().min(1),                    // who actually wrote it
  licence: z.string(),
  language: z.string().optional(),
  page_offset: z.number().int().optional(),       // printed page minus PDF index (ACS: 3719)
  pdf_path: z.string().nullable().optional(),
});

export const Meta = z.object({
  title: z.string().min(1),
  topic_id: z.string().min(1),
  template: Template,
  audience: z.array(z.enum(["MG", "urgences"])).min(1), // CONFIRM Q15 (list vs string)
  version: z.string(),                            // CONFIRM Q15
  status: z.enum(["draft", "review", "published"]),
  reviewer: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  siblings: z.array(z.string()),
  sources: z.array(SourceMeta).min(1),
  excluded_by_audience: z.array(z.string()),
  quote_check: z.string().optional(),             // "x/y", computed
  motifs: z.array(z.string()).default([]),        // NEW: reasons for consultation (search, home)
  specialite: z.string().min(1),                  // NEW: drives the library grouping
});

export const Fiche = z.object({ kind: z.literal("fiche"), meta: Meta, sections: Sections });

/** NEW types: same sourcing rules (every content line is an Element with a SourceRef). CONFIRM Q10 for their body fields. */
export const Score = z.object({ kind: z.literal("score"), id: z.string().regex(/^S-\d{3,}$/), meta: Meta.omit({ template: true }), elements: z.array(Element) });
export const FicheTechnique = z.object({ kind: z.literal("fiche_technique"), id: z.string().regex(/^F-\d{3,}$/), meta: Meta.omit({ template: true }), elements: z.array(Element) });
```

### Display config (data, in `packages/schema`, not hard-coded in screens)

```ts
export const DISPLAY = {
  urgence:    { visible: ["4_gravite.decision_initiale", "1_essentiel", "4_gravite", "6_examens", "7_traitement", "8_ne_pas_faire", "9_orientation", "12_ordonnance"], rest: "collapsed", maxVisibleElements: 40 }, // 12 hidden when sans_objet (D3)
  pathologie: { visible: ["2_presentation", "5_conduite", "7_traitement", "12_ordonnance"], rest: "collapsed", maxVisibleElements: null }, // CONFIRM Q13
  state: { sans_objet: "hidden", "non_traité": "Non traité par la source" },
} as const;
```

- **Order on screen, block placement and visible/collapsed per template:** FORMAT_MAPPING.md §2 (the display map; put it in `packages/schema` as data). The order is `[Décision initiale]` (urgence) → `[L'essentiel]` → Reconnaître → Étapes → `[Conduite à tenir]` → Bilans → Traitement → À ne pas faire → Orienter → Suivi → `[Champ d'application]` → `[Définitions]`. Blocks that mix visible and collapsed numbered parts (Reconnaître, Bilans) show the visible sub-blocks open and the rest as one collapsed row.
- **Lists:** 4 items, then "Voir plus (N)" (a display rule, never a data limit). Transfer criteria are always all shown.
- **Dose card:** red lines on the closed card are derived: the posologie's `dose_max`, plus elements `attached_to` it with `risk: high` in `7_traitement.contre_indications` or `8_ne_pas_faire`. Other attached elements go under "Détails". Attached lines sharing a `conflict_group` render as a segmented switch (Q22).
- **"Collapsed":** the step-card pattern of `Protocol.tsx`.
- **`non_traité`:** an amber card with the text "Non traité par la source" (string `not_covered_section` in `fr.ts`).

### Validation (`validateFiche(f, ctx)` → `{ failures[], warnings[] }`; any failure blocks publishing)

**Failures:**

- Every element (in sections, nodes, branches, decision_initiale, contre_indications, scores, fiches techniques) and every posologie has `source.quote` **and** `source.page`. No quote, no line.
- **Max 3 nesting levels** (CONFIRM Q12 for what counts; default: section → sub-block or node → element).
- `filled` has at least 1 element; `non_traité` and `sans_objet` have 0.
- `type: conditional` needs `condition`.
- `1_essentiel` has at most 3 elements.
- No duplicate id. No identical text in two sections.
- Exam terms (ECG, biology, imaging) are never in `2_presentation`. A line starting with "Ne pas / Ne jamais / Éviter / Proscrire / S'abstenir" goes in `8_ne_pas_faire` only.
- Posologies, contre_indications and section 8 are `risk: high`, and every risk-high element is `checked` before publishing.
- `status: published` needs `reviewer` and `reviewed_at`.
- **Refs:** cannot publish while any `refs[]` id (or `meta.siblings` id) is missing, or points to an object that is not published (`ctx.resolve(id)`). Test case: stroke → `avc-thrombolyse` (D6) must fail.
- `decision_initiale` present on a pathologie fiche, or absent on an urgence fiche (D3).
- `attached_to` points to a posologie id of the same fiche. `phase` is set only on `9_orientation` elements.
- No v4-shaped document is accepted anywhere (D1).
- Port the remaining rules 1 to 8 from `protocol_v1.validate`.

**Server-side failures** (`services/api`, needs the PDF): the quote is on the cited page (`verify.py`), and every number in the element appears in its quote.

**Warnings:**

- **Visible element count above `maxVisibleElements`** (40 for urgence).
- An exam term outside section 6.
- A brand name typed in text.
- `missing` dose fields.
- A source older than 5 years.

## Build order (small runnable steps; each ends with something I can run)

1. Monorepo skeleton: npm workspaces, TS config, lint; `apps/mobile` boots an empty Expo router screen on web; `apps/dashboard` boots an empty Next page. **Check:** both dev servers start.
2. `packages/ui-tokens` from `design-tokens.json`; wire it into NativeWind (app) and Tailwind 4 (dashboard); bundle the fonts. **Check:** a token test screen at light and dark, compared with the screenshots.
3. Port the app primitives (`ui.tsx`, `Icons.tsx`, `ThemeProvider`). **Check:** a primitives gallery screen.
4. `packages/schema`: Zod schema, display map (FORMAT_MAPPING.md §2), validator, plus tests (after I approve a runner) using **fake** text. Ask Q21 to Q26 first. **Check:** the tests pass and the JSON Schema export works.
5. An import script: `content/` → schema (no hand edits; report anything that does not fit instead of guessing). **Check:** the stroke and ACS references validate, or produce a list of findings for me; stroke must report the missing `avc-thrombolyse` ref (D6).
6. Fiche screen, phone: header, jump bar, blocks via the FORMAT_MAPPING.md §2 display map, SourceSheet. Reads local fixture files only. **Check:** stroke and ACS at 390 px side by side with `screenshots/`.
7. Fiche screen, wide (≥1100): sidebar, content, source column. **Check:** at 1440 px against the screenshots.
8. Library: home, search, favourites, recents, offline cache; Médicaments if Q14 keeps it. **Check:** offline reload works.
9. Supabase: migrations (staff, subjects, fiche_versions, published_fiches, sources bucket), auth, RLS; the app reads published fiches. **Check:** publish a fixture, see it in the app.
10. `services/api` (Python, ported not rewritten; `requirements.txt` with pypdf and PyYAML): PDF text, the quote-on-page check, the brand matcher (from `register.py` + `dz_brands.json`), publish endpoint. **Check:** pytest plus one end-to-end publish.
11. Dashboard shell + login + staff roles + Protocoles hub with check cards and the publish gate. **Check:** a hub listing the imported fiches.
12. Editor: PDF beside the form, read-first items, field editing per schema, server checks, paste JSON, save as a new version, publish. **Check:** edit one stroke line, see the check update, publish.
13. Crawler: port `scraper/` to `services/crawler`; dashboard Collecte (search, download, add by URL, upload). **Check:** run the topic search for one topic and add one PDF by URL.
14. Scores (S-xxx) and fiches techniques (F-xxx) with refs resolution, after Q10 and Q11 are answered.

Before each step that touches an open question, ask it. After each step, show what you ran and what came out.
