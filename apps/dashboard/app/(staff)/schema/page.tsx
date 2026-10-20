"use client";

import { protocolJsonSchema, publicationGate, validateStructure, type Issue, type Rule } from "@avero/schema";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Card, PageHeader, Spinner, Tag } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// The fiche format (docs/protocol_schema_v1.1.md) shown to whoever opens the dashboard: the flow from a guideline to
// the app, the screens, each building block with its fields (read from the Zod schema's JSON Schema, so they cannot
// drift), the rules, and the validator itself to try on any JSON.

type JsonNode = { type?: string | string[]; enum?: string[]; const?: unknown; anyOf?: JsonNode[]; items?: JsonNode; $ref?: string; pattern?: string; minLength?: number; exclusiveMinimum?: number; minimum?: number };
type JsonDef = { properties: Record<string, JsonNode>; required?: string[] };

const FLOW = [
  { title: "Guideline PDF", body: "An official guideline (HAS, ESC, AHA/ACC, the Algerian ministry…) found and stored in Sources." },
  { title: "Fiche JSON", body: "Each clinical line is a short French instruction with the verbatim quote and the page it comes from." },
  { title: "Automatic checks", body: "Structure on every save; the quote found on its PDF page; every number of the line inside its quote; the decision tree; brands from the national register." },
  { title: "Block-by-block review", body: "A reviewer ticks each block against the PDF. Editing a block clears its tick." },
  { title: "Doctor approval → app", body: "A named doctor signs the clinical approval; only then can the version be published to the doctors' app." },
];

const SCREENS = [
  { key: "red_box", title: "Red box", body: "When to call the SAMU or send to the emergency department, and what to do meanwhile.", tone: "urgent" as const },
  { key: "assess", title: "Évaluer (assess)", body: "Signs and symptoms, questions to ask, signs to examine, diagnostic confirmation, tests, and a decision tree with numbered steps." },
  { key: "treat", title: "Traiter (treat)", body: "Drugs with the dose inline, a pharmacy/hospital tag and the Algerian brands; other measures; what not to do." },
  { key: "advise", title: "Conseiller (advise)", body: "What to tell the patient." },
  { key: "refer_follow", title: "Orienter et suivre", body: "Referral in one of 3 fixed phrases (urgently / within the week / at the next visit), and a when/what follow-up table." },
  { key: "sources · review", title: "Sources and review", body: "Citations, the reviewer, the approval, unresolved conflicts between sources, the change log." },
];

const BLOCKS: { def: string; title: string; about: string; example: string }[] = [
  {
    def: "Item", title: "Item", about: "Every clinical line (signs, questions, examination, tests, actions, do-not, advice).",
    example: `{
  "id": "ep-001",
  "text": "Dosez les D-dimères ajustés à l'âge (âge × 10 µg/L).",
  "condition": "probabilité clinique < 50 %",
  "timing": null,
  "strength": "modérée",
  "origin": "source",
  "basis": null,
  "evidence": [
    { "source_id": "aha-acc-2026", "page": 1633,
      "quote": "an age-adjusted D-dimer value below the threshold..." }
  ],
  "refs": []
}`,
  },
  {
    def: "Medication", title: "Medication", about: "A drug by its international name (DCI), its dose, and its availability in Algeria.",
    example: `{
  "id": "med-apixaban-init",
  "inn": "apixaban",
  "phase": "initiation",
  "dose": 10, "dose_unit": "mg", "dose_basis": "fixe",
  "route": "orale", "frequency": "2 fois par jour", "duration": "7 jours",
  "max_dose": null, "condition": null,
  "adjustments": [], "contraindications": [],
  "alternative_group": "aod-initiation",
  "prescriber": "officine",
  "local_availability": { "country": "DZ", "status": "enregistre",
    "brands": ["APIXABEK", "APIXAR", "BIOPEXA", "INIBIX", "XIBAN"] },
  "strength": "forte",
  "evidence": [],
  "missing": []
}`,
  },
  {
    def: "PathwayNode", title: "Decision step", about: "One step of the decision tree: a question with its answers, an action, or an end.",
    example: `{
  "id": "n1",
  "type": "decision",
  "question": "Probabilité clinique ?",
  "branches": [
    { "id": "b1", "label": "< 15 %", "next_node_id": "n2" },
    { "id": "b2", "label": "< 50 %", "next_node_id": "n3" },
    { "id": "b3", "label": "> 50 %", "next_node_id": "n4" }
  ],
  "items": []
}`,
  },
  {
    def: "Referral", title: "Referral", about: "When to refer, how urgently (3 fixed levels), and where.",
    example: `{ "id": "ref-1", "criteria": "Catégorie C, D ou E",
  "urgency": "urgent", "destination": "hospitalisation",
  "strength": null, "evidence": [] }`,
  },
  {
    def: "FollowUp", title: "Follow-up", about: "One row of the when/what follow-up table.",
    example: `{ "id": "fu-1", "when": "J7",
  "what": "Observance, saignements, éducation", "evidence": [] }`,
  },
  {
    def: "Source", title: "Source", about: "The guideline a quote comes from; page_offset maps printed pages to PDF pages.",
    example: `{
  "id": "aha-acc-2026",
  "title": "2026 AHA/ACC Guideline for the Evaluation and Management of Acute Pulmonary Embolism in Adults",
  "organisation": "AHA/ACC",
  "citation": "Creager MA et al. J Am Coll Cardiol 2026;87(13):1626-1710",
  "url": "https://doi.org/10.1016/j.jacc.2025.11.005",
  "publication_date": "2026-04-07",
  "page_offset": -1625,
  "accessed_at": "2026-10-15"
}`,
  },
  {
    def: "Evidence", title: "Evidence", about: "The proof behind a line: the source, the printed page, and the original wording.",
    example: `{ "source_id": "aha-acc-2026", "page": 1633,
  "quote": "an age-adjusted D-dimer value below the threshold..." }`,
  },
];

/** What each field means, for the tables (types and allowed values come from the schema itself). */
const FIELD_NOTE: Record<string, string> = {
  id: "Unique within the fiche",
  text: "The instruction, in French, active voice, addressed to the doctor",
  condition: "\"Si …\": when the line applies",
  timing: "How soon",
  strength: "Strength of the recommendation in the source",
  origin: "From the source, or a local adaptation",
  basis: "Required for a local adaptation: why",
  evidence: "At least one quote, unless a signed local adaptation",
  refs: "Scores or other fiches this line points to",
  inn: "International non-proprietary name (DCI)",
  phase: "Initiation, maintenance, extended or single dose",
  dose: "A number, never text",
  dose_unit: "mg, µg, UI…",
  dose_basis: "Fixed or per kg",
  route: "Route of administration",
  frequency: "How often",
  duration: "How long",
  max_dose: "Upper bound when the source gives one",
  adjustments: "Renal, hepatic, age…",
  contraindications: "Shown in red",
  alternative_group: "Same value = interchangeable, shown as \"ou\"",
  prescriber: "Pharmacy or hospital, from the national register (OFF / HOP)",
  local_availability: "Status and brands, from the national register only",
  missing: "Fields the sources do not give: shown as [à compléter], never invented",
  type: "Question, action or end",
  question: "The question asked at this step",
  branches: "Answers, each leading to another step",
  items: "Lines shown inside the step",
  criteria: "When to refer",
  urgency: "Urgently / within the week / at the next visit",
  destination: "Where to",
  when: "e.g. J7, M3",
  what: "What to check",
  title: "Full title of the guideline",
  organisation: "Issuing body",
  citation: "Bibliographic citation",
  url: "DOI link or official page",
  publication_date: "Date of the guideline",
  page_offset: "PDF page minus printed page",
  accessed_at: "When it was retrieved",
  source_id: "A source of this fiche",
  page: "The printed page number",
  quote: "Verbatim, in the source's language: checked on the PDF page",
};

const RULE_LABEL: Record<Rule, string> = {
  structure: "Structure", required: "Required fields", ids: "Identifiers", evidence: "Evidence", basis: "Local adaptation", quote: "Quote on its page",
  numbers: "Numbers in the quote", pathway: "Decision tree", refs: "References", missing: "Prescribing fields", availability: "Algerian availability", approval: "Clinical approval",
};

const WRITING = [
  "Active voice, addressed to the doctor: \"Dosez\", \"Adressez\", \"Prescrivez\".",
  "No vague lines (\"faire un examen complet\"): the exact question or sign, and what to do with each answer.",
  "No pathophysiology, no epidemiology: only what the doctor does.",
  "Referral always in one of 3 phrases: en urgence / dans la semaine / au prochain rendez-vous.",
  "1 to 5 phone screens per fiche. If it does not fit, cut.",
];
const SOURCING = [
  "Every clinical line has at least one evidence entry, or is a local adaptation with its basis.",
  "Numbers (doses, thresholds, durations) must appear verbatim in the quote; checked automatically against the page.",
  "The text is a short French synthesis; the quote keeps the original wording for the reviewer.",
  "Conflicting sources go in review.unresolved_issues, never silently merged.",
  "Brands only from the Algerian national register (nomenclature). Optional: with none picked, the app lists the register's products of the INN.",
];
const GATE = [
  "Every line has evidence or an approved local adaptation.",
  "Every quote is found on its page of the stored PDF.",
  "No medication has a prescribing field (phase, dose, unit, dose basis, route, frequency) missing; duration, max dose, adjustments, contraindications and strength may be published as [à compléter].",
  "Every branch of the decision tree leads somewhere: no dead ends.",
  "Every referenced score or fiche exists and is published.",
  "A named doctor has approved it (review.clinical_approval = true).",
];

/** A JSON Schema node, as a short type: "string | null", "forte | modérée | …", "Evidence[]". */
function typeOf(n: JsonNode): string {
  if (n.$ref) return n.$ref.split("/").pop()!;
  if (n.const !== undefined) return JSON.stringify(n.const);
  if (n.enum) return n.enum.join(" | ");
  if (n.anyOf) return n.anyOf.map(typeOf).join(" | ");
  if (n.type === "array") return `${n.items ? wrap(typeOf(n.items)) : "unknown"}[]`;
  const t = Array.isArray(n.type) ? n.type.join(" | ") : n.type ?? "any";
  return n.type === "number" && n.exclusiveMinimum === 0 ? "number > 0" : t;
}
const wrap = (t: string) => (t.includes("|") ? `(${t})` : t);

function FieldTable({ def }: { def: JsonDef }) {
  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="py-2 pe-3 font-semibold">Field</th><th className="py-2 pe-3 font-semibold">Type / allowed values</th><th className="py-2 font-semibold">Meaning</th></tr>
      </thead>
      <tbody>
        {Object.entries(def.properties).map(([k, v]) => (
          <tr key={k} className="border-b border-line/70 align-top last:border-0">
            <td className="py-2 pe-3 font-mono text-[12.5px] font-semibold text-ink">{k}</td>
            <td className="py-2 pe-3 font-mono text-[12px] text-accentink">{typeOf(v)}</td>
            <td className="py-2 text-soft">{FIELD_NOTE[k] ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Rules({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className={`text-sm font-semibold ${tone}`}>{title}</h3>
      <ol className="flex flex-col gap-2.5">
        {items.map((r, i) => (
          <li key={i} className="flex gap-2.5 text-[13.5px] leading-[19px] text-ink">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-panel text-[11px] font-bold text-soft">{i + 1}</span>{r}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Paste any JSON (or load a real fiche) and run the two levels on it, as the editor does on every change. */
function Validator() {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const result = useMemo(() => {
    if (!text.trim()) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { parse: (e as Error).message, structure: [] as Issue[], gate: [] as Issue[] };
    }
    const { protocol, issues } = validateStructure(raw);
    // Quotes are checked against the stored PDFs by the API; here every other gate rule.
    const gate = protocol ? publicationGate(protocol, { published: new Set(), quotes: {} }).filter((i) => i.rule !== "quote") : [];
    return { parse: null, structure: issues, gate };
  }, [text]);
  const loadExample = async () => {
    setLoading(true);
    const { data } = await supabase.from("fiche_versions").select("content").not("published_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
    setLoading(false);
    if (data) setText(JSON.stringify((data as { content: unknown }).content, null, 2));
  };
  const byRule = (list: Issue[]) => [...list.reduce((m, i) => m.set(i.rule, [...(m.get(i.rule) ?? []), i]), new Map<Rule, Issue[]>())];

  return (
    <Card className="grid grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
      <div className="flex flex-col gap-2 border-line p-4 lg:border-e">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm font-semibold text-ink">Fiche JSON</span>
          <Button className="h-8 text-xs" disabled={loading} onClick={() => void loadExample()}>{loading ? <Spinner /> : "Load a published fiche"}</Button>
          {text && <Button variant="ghost" className="h-8 text-xs" onClick={() => setText("")}>Clear</Button>}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder='Paste a fiche here, or load a published one and change something (try "strength": "very strong", or an extra field).'
          className="h-80 w-full resize-y rounded-lg border border-edge/15 bg-input p-3 font-mono text-[12px] leading-[17px] text-ink placeholder:font-sans placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </div>
      <div className="flex max-h-[24rem] flex-col gap-3 overflow-auto p-4 text-sm">
        {!result ? (
          <p className="text-muted">The result shows here: first the structure (shape, field names, allowed values; anything unknown is rejected), then the publication gate.</p>
        ) : result.parse ? (
          <p className="text-flag">Not JSON: {result.parse}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="w-28 text-xs font-semibold uppercase tracking-wide text-muted">1 · Structure</span>
              {result.structure.length ? <Tag tone="urgent">{result.structure.length} error{result.structure.length > 1 ? "s" : ""}</Tag> : <Tag tone="accent">valid Protocol v1.1</Tag>}
            </div>
            {result.structure.slice(0, 30).map((i, k) => <p key={k} className="font-mono text-[12px] text-flag">{i.message}</p>)}
            {!result.structure.length && (
              <>
                <div className="flex items-center gap-2 border-t border-line pt-3">
                  <span className="w-28 text-xs font-semibold uppercase tracking-wide text-muted">2 · Gate</span>
                  {result.gate.length ? <Tag tone="caution">{result.gate.length} to resolve</Tag> : <Tag tone="accent">passes (quotes aside)</Tag>}
                </div>
                {byRule(result.gate).map(([rule, list]) => (
                  <div key={rule} className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-ink">{RULE_LABEL[rule]} <span className="font-normal text-muted">({list.length})</span></p>
                    {list.slice(0, 5).map((i, k) => <p key={k} className="text-[12.5px] leading-[17px] text-soft">{i.item_id ? <span className="font-mono text-muted">{i.item_id} · </span> : null}{i.message}</p>)}
                    {list.length > 5 && <p className="text-xs text-muted">and {list.length - 5} more</p>}
                  </div>
                ))}
                <p className="border-t border-line pt-3 text-xs text-muted">The quote check runs on the server: it opens the stored PDF and looks for each quote on its page.</p>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export default function SchemaPage() {
  const schema = useMemo(() => protocolJsonSchema() as unknown as { $defs: Record<string, JsonDef> }, []);
  const [block, setBlock] = useState(BLOCKS[0].def);
  const b = BLOCKS.find((x) => x.def === block)!;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "protocol.schema.json" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-12 px-5 py-8">
      <div>
        <PageHeader title="The fiche format"
          subtitle="Protocol Schema v1.1, frozen. Every fiche in Avero is one JSON file that passes it: one condition, 1 to 5 phone screens."
          actions={<Button onClick={download}>Download the JSON Schema</Button>} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ["Strict", "Every object is closed: an unknown field, a misspelled key or a value outside its list is rejected."],
            ["Sourced", "Every clinical line carries its quote and page; the numbers in a line must appear in its quote."],
            ["Two checks", "The structure on every save, the publication gate before a version can reach the app."],
          ].map(([t, d]) => (
            <Card key={t} className="p-4">
              <p className="text-sm font-semibold text-accentink">{t}</p>
              <p className="mt-1 text-[13px] leading-[19px] text-soft">{d}</p>
            </Card>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-ink">From a guideline to the doctor&apos;s phone</h2>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {FLOW.map((s, i) => (
            <li key={s.title} className="relative flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-4">
              <span className="grid size-6 place-items-center rounded-full bg-tint text-xs font-bold text-accentink">{i + 1}</span>
              <p className="text-sm font-semibold text-ink">{s.title}</p>
              <p className="text-[12.5px] leading-[18px] text-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-base font-semibold text-ink">What the doctor sees, in order</h2>
          <Link href="/protocoles" className="text-sm text-accentink hover:underline">See a real fiche ›</Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCREENS.map((s, i) => (
            <Card key={s.key} className={`flex flex-col gap-1.5 p-4 ${s.tone === "urgent" ? "border-2 border-flag/70" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                <p className={`flex-1 text-sm font-semibold ${s.tone === "urgent" ? "text-flag" : "text-ink"}`}>{s.title}</p>
                <code className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-soft">{s.key}</code>
              </div>
              <p className="text-[13px] leading-[19px] text-soft">{s.body}</p>
            </Card>
          ))}
        </div>
        <p className="text-[13px] text-muted">Two templates share the same JSON: <b className="font-semibold text-soft">urgence</b> (red box filled, decision tree, referral before follow-up) and <b className="font-semibold text-soft">pathologie</b> (assess as a checklist, advise before treat). Empty means not applicable; nothing is filled for the sake of it.</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-ink">Building blocks</h2>
        <div className="flex flex-wrap gap-1">
          {BLOCKS.map((x) => (
            <button key={x.def} type="button" onClick={() => setBlock(x.def)}
              className={`rounded-lg px-3 py-1.5 text-sm ${x.def === block ? "bg-tint font-medium text-accentink" : "text-soft hover:bg-panel hover:text-ink"}`}>{x.title}</button>
          ))}
        </div>
        <Card className="grid grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-sm text-soft">{b.about}</p>
            <FieldTable def={schema.$defs[b.def]} />
            <p className="text-xs text-muted">All fields are required (null where allowed); no other field is accepted.</p>
          </div>
          <pre className="overflow-auto border-t border-line bg-panel/60 p-5 font-mono text-[12px] leading-[18px] text-ink lg:border-s lg:border-t-0">{b.example}</pre>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-ink">The rules</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Rules title="Writing (PACK)" items={WRITING} tone="text-ink" />
          <Rules title="Sourcing" items={SOURCING} tone="text-accentink" />
          <Rules title="Publication gate" items={GATE} tone="text-flag" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Try the validator</h2>
          <p className="mt-1 text-sm text-soft">The same code the editor runs on every change (packages/schema), here in your browser.</p>
        </div>
        <Validator />
      </section>
    </div>
  );
}
