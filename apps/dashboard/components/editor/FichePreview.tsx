"use client";

import {
  AVAILABILITY_LABEL, doseLine, pathwayProblems, PHASE_LABEL, PRESCRIBER_LABEL, SECTION_TITLE, STRENGTH_LABEL, URGENCY_LABEL,
  type Evidence, type FollowUp, type Item, type Medication, type Pathway, type PathwayNode, type Protocol, type Referral, type Strength, type Urgency,
} from "@avero/schema";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { IssuesCtx, LineIssues, ReviewCtx, ShowCtx, type Reviewed } from "./fields";
import { blankItem, EnvCtx, ItemDetails } from "./ItemEditor";
import { blankMedication, MedicationDetails } from "./MedicationEditor";
import { FollowUpDetails, ReferralDetails } from "./ReferFollowEditor";

// The fiche drawn as the app publishes it (apps/mobile/src/fiche: red box, cards, rose "À ne pas faire", numbered
// decision tree, medication rows, referral and follow-up table), and edited in place: each text is typed where it
// shows, "⋯" opens a line's other fields, the round box on the right ticks it as checked against the PDF, and a
// click (or the cursor in it) shows its quote in the PDF. Headings are the app's, in French, as published.

const TO_FILL = "[à compléter]";
const CARD = "rounded-card border border-edge/[0.06] bg-surface px-[18px] pb-[6px] pt-4 shadow-surface";

/** The line being worked on (its quote shown), and a new line to put the cursor in. */
const ActiveCtx = createContext<{ active: string | null; setActive: (id: string) => void; focus: string | null; setFocus: (id: string | null) => void }>({
  active: null, setActive: () => {}, focus: null, setFocus: () => {},
});

/** Read only (signed out): the fiche as published, its quotes shown on click, no editing tools. */
const ReadOnlyCtx = createContext(false);

/** Text typed in place: looks like the published text, grows with it; Enter calls `onEnter` (a new line below). */
function Inline({ value, onChange, placeholder = TO_FILL, className = "", focusMe, onEnter }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; className?: string; focusMe?: boolean; onEnter?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { setFocus } = useContext(ActiveCtx);
  const ro = useContext(ReadOnlyCtx);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useLayoutEffect(() => {
    if (!focusMe) return;
    ref.current?.focus();
    setFocus(null);
  }, [focusMe, setFocus]);
  return (
    <textarea ref={ref} rows={1} value={value ?? ""} placeholder={placeholder} readOnly={ro}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter?.(); } }}
      className={`-mx-1 block w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded-md bg-transparent px-1 outline-none placeholder:font-normal placeholder:text-caution/70 ${ro ? "cursor-default" : "hover:bg-panel/70 focus:bg-surface focus:ring-2 focus:ring-accent/30"} ${className}`} />
  );
}

/** The small grey tag under a line, as in the app (source, page, strength), with its quote check; a click shows it. */
function TagLine({ id, evidence, strength, local }: { id: string; evidence: Evidence[]; strength: Strength | null; local?: boolean }) {
  const { sources } = useContext(EnvCtx);
  const review = useContext(ReviewCtx);
  const show = useContext(ShowCtx);
  const e = evidence[0];
  const name = e ? sources.find((s) => s.id === e.source_id)?.organisation || e.source_id : null;
  const parts = [local ? "adaptation locale" : null, name, e?.page ? `p. ${e.page}` : null, strength ? STRENGTH_LABEL[strength] : null].filter(Boolean);
  const q = evidence.length ? review?.quote(id) : undefined;
  return (
    <button type="button" onClick={() => e && show({ evidence: e, label: "" })} className="self-start text-left text-[11.5px] leading-4 text-muted hover:text-accentink">
      {parts.length ? parts.join(" · ") : <span className="text-caution">no evidence</span>}
      {evidence.length > 1 ? ` +${evidence.length - 1}` : ""}
      {q === "found" ? <span className="text-accent"> · quote ✓</span> : q === "missing" ? <span className="text-flag"> · quote not found</span> : null}
    </button>
  );
}

const tool = "grid size-6 place-items-center rounded-md text-[13px] text-muted hover:bg-panel hover:text-ink disabled:opacity-25";

/** A line of a card: its content, the check box, and on hover its tools (⋯ fields, move, delete). */
function Row({ line, first, rule = "border-line", details, onMove, onDelete, canUp, canDown, children }: {
  line: Reviewed; first?: boolean; rule?: string; details: ReactNode; onMove: (d: -1 | 1) => void; onDelete: () => void; canUp: boolean; canDown: boolean;
  children: ReactNode | ((openDetails: () => void) => ReactNode);
}) {
  const review = useContext(ReviewCtx);
  const issues = useContext(IssuesCtx).get(line.id) ?? [];
  const { active, setActive } = useContext(ActiveCtx);
  const show = useContext(ShowCtx);
  const [open, setOpen] = useState(false);
  const ro = useContext(ReadOnlyCtx);
  const done = review?.verified(line) ?? false;
  const on = active === line.id;
  const select = () => {
    if (active === line.id) return;
    setActive(line.id);
    const e = line.evidence[0];
    if (e) show({ evidence: e, label: "" });
  };
  return (
    <div id={`line-${line.id}`} className={`group/row relative scroll-mt-36 ${first ? "" : `border-t ${rule}`}`} onFocusCapture={select} onMouseDown={select}>
      {on && <span className="absolute -left-[18px] bottom-2 top-2 w-[3px] rounded-full bg-accent" />}
      <div className="flex gap-2 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {typeof children === "function" ? children(() => setOpen(true)) : children}
          {on && line.evidence[0]?.quote && <p className="mt-1 border-s-2 border-accent/40 ps-2 text-[12px] italic leading-[17px] text-soft">“{line.evidence[0].quote}”</p>}
        </div>
        <div className="flex shrink-0 items-start gap-1 pt-0.5">
          {!ro && <div className="pointer-events-none absolute -top-3 right-8 z-10 flex rounded-lg border border-edge/10 bg-surface p-0.5 opacity-0 shadow-control transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100">
            <button type="button" className={`${tool} ${open ? "bg-panel text-ink" : ""}`} title="Other fields" onClick={() => setOpen(!open)}>⋯</button>
            <button type="button" className={tool} title="Move up" disabled={!canUp} onClick={() => onMove(-1)}>↑</button>
            <button type="button" className={tool} title="Move down" disabled={!canDown} onClick={() => onMove(1)}>↓</button>
            <button type="button" className={`${tool} hover:text-flag`} title="Delete" onClick={onDelete}>✕</button>
          </div>}
          {issues.length > 0 && !ro && (
            <button type="button" title={issues.map((i) => i.message).join("\n")} onClick={() => setOpen(true)}
              className="grid h-6 min-w-6 place-items-center rounded-md bg-flagbg px-1 text-[11px] font-semibold text-flag">{issues.length}</button>
          )}
          {review && ro ? (done && <span title="Checked against the PDF" className="grid size-6 place-items-center rounded-full bg-accent text-[12px] font-bold text-surface">✓</span>)
            : review && (
            <button type="button" title={done ? "Checked against the PDF (click to undo)" : "Mark as checked against the PDF"} onClick={() => review.toggle(line)}
              className={`grid size-6 place-items-center rounded-full border text-[12px] font-bold transition-colors ${done ? "border-accent bg-accent text-surface" : "border-edge/25 text-transparent hover:border-accent hover:text-accent"}`}>✓</button>
          )}
        </div>
      </div>
      {open && !ro && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
          {details}
          <LineIssues id={line.id} />
          <button type="button" className="self-end rounded-md px-2 py-1 text-xs font-medium text-accentink hover:bg-tint" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}

/** Move, remove, insert in a list, keeping the others. */
function ops<T>(items: T[], onChange: (v: T[]) => void) {
  return {
    set: (i: number, v: T) => onChange(items.map((x, k) => (k === i ? v : x))),
    move: (i: number, d: -1 | 1) => { const n = [...items]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); },
    del: (i: number) => onChange(items.filter((_, k) => k !== i)),
    insert: (i: number, v: T) => { const n = [...items]; n.splice(i, 0, v); onChange(n); },
  };
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  if (useContext(ReadOnlyCtx)) return null;
  return <button type="button" onClick={onClick} className="self-start rounded-md py-2 text-[13px] font-semibold text-accent hover:underline">+ {children}</button>;
}

/** Lines of a card: "Si …", the text, the tag; Enter in a text starts a new line below. */
function ItemList({ items, onChange, add, rule, textClass = "text-ink" }: { items: Item[]; onChange: (v: Item[]) => void; add: string; rule?: string; textClass?: string }) {
  const { newId } = useContext(EnvCtx);
  const { focus, setFocus } = useContext(ActiveCtx);
  const o = ops(items, onChange);
  const addAt = (i: number) => { const it = blankItem(newId("it")); o.insert(i, it); setFocus(it.id); };
  return (
    <div className="flex flex-col">
      {items.map((it, i) => (
        <Row key={it.id} line={it} first={i === 0} rule={rule} canUp={i > 0} canDown={i < items.length - 1} onMove={(d) => o.move(i, d)} onDelete={() => o.del(i)}
          details={<ItemDetails item={it} onChange={(v) => o.set(i, v)} />}>
          {it.condition !== null && (
            <div className="flex items-baseline gap-1 text-[13px] leading-[18px] text-soft">
              <span>Si</span><Inline value={it.condition} placeholder="condition" onChange={(v) => o.set(i, { ...it, condition: v || null })} />
            </div>
          )}
          <Inline value={it.text} focusMe={focus === it.id} onChange={(text) => o.set(i, { ...it, text })} onEnter={() => addAt(i + 1)} className={`text-[14.5px] leading-[21px] ${textClass}`} />
          <TagLine id={it.id} evidence={it.evidence} strength={it.strength} local={it.origin === "adaptation_locale"} />
        </Row>
      ))}
      <AddButton onClick={() => addAt(items.length)}>{add}</AddButton>
    </div>
  );
}

const Card = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className={`${CARD} ${title ? "" : "pt-[6px]"}`}>
    {title && <p className="pb-[2px] text-[15px] font-bold text-ink">{title}</p>}
    {children}
  </div>
);

function RedBox({ f, edit }: { f: Protocol; edit: Edit }) {
  const ro = useContext(ReadOnlyCtx);
  const [open, setOpen] = useState(false);
  // an empty box is not shown (as in the app); a pathologie fiche often has none, so editors add it on demand
  if (!f.red_box.signs.length && !f.red_box.actions.length && (ro || (f.meta.template === "pathologie" && !open))) {
    return ro ? null : <AddButton onClick={() => setOpen(true)}>Appelez le SAMU si… (signes d&apos;alerte)</AddButton>;
  }
  return (
    <div className="rounded-card border-2 border-flag bg-surface px-[18px] pb-[6px] pt-4">
      <p className="flex items-center gap-2 pb-[2px] text-[15.5px] font-bold leading-[21px] text-flag"><span aria-hidden>⚠</span>Appelez le SAMU ou adressez aux urgences si :</p>
      <ItemList items={f.red_box.signs} rule="border-flag/15" add="sign" onChange={(v) => edit((d) => void (d.red_box.signs = v))} />
      <p className="border-t border-flag/15 pt-3 text-[13px] font-bold uppercase tracking-[0.4px] text-flag">En attendant</p>
      <ItemList items={f.red_box.actions} rule="border-flag/15" add="action meanwhile" onChange={(v) => edit((d) => void (d.red_box.actions = v))} />
    </div>
  );
}

function MedicationList({ items, onChange }: { items: Medication[]; onChange: (v: Medication[]) => void }) {
  const { newId } = useContext(EnvCtx);
  const { focus, setFocus } = useContext(ActiveCtx);
  const o = ops(items, onChange);
  return (
    <div className={CARD}>
      <p className="pb-[2px] text-[15px] font-bold text-ink">Médicaments</p>
      {items.map((m, i) => {
        const alt = i > 0 && !!m.alternative_group && m.alternative_group === items[i - 1].alternative_group;
        const hosp = m.prescriber === "hopital";
        const { brands, status } = m.local_availability;
        return (
          <div key={m.id}>
            {alt && <p className="-mb-1 pt-1 text-[12px] font-bold uppercase text-muted">ou</p>}
            <Row line={m} first={i === 0 || alt} canUp={i > 0} canDown={i < items.length - 1} onMove={(d) => o.move(i, d)} onDelete={() => o.del(i)}
              details={<MedicationDetails med={m} onChange={(v) => o.set(i, v)} />}>
              {(openDetails) => (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-32 max-w-72 flex-1"><Inline value={m.inn} placeholder="DCI" focusMe={focus === m.id} onChange={(inn) => o.set(i, { ...m, inn })} className="text-[15px] font-bold capitalize text-ink" /></div>
                    {m.phase && <span className="text-[12.5px] text-soft">{PHASE_LABEL[m.phase]}</span>}
                    {m.prescriber && <span className={`rounded-full px-2 py-[2px] text-[11px] font-semibold ${hosp ? "bg-cautionbg text-caution" : "bg-tint text-accentink"}`}>{PRESCRIBER_LABEL[m.prescriber]}</span>}
                  </div>
                  {m.condition && <p className="text-[13px] leading-[18px] text-soft">Si {m.condition}</p>}
                  <button type="button" onClick={openDetails} className="-mx-1 rounded-md px-1 text-left text-[14.5px] font-medium leading-[21px] text-ink hover:bg-panel/70">{doseLine(m)}</button>
                  {m.max_dose && <p className="text-[13px] leading-[18px] text-soft">Dose maximale : {m.max_dose}</p>}
                  {m.adjustments.map((a, k) => <p key={k} className="text-[13px] leading-[18px] text-soft">{a}</p>)}
                  {m.contraindications.length > 0 && <p className="text-[13px] leading-[18px] text-flag">Contre-indications : {m.contraindications.join(" ; ")}</p>}
                  <button type="button" onClick={openDetails} className="self-start text-left text-[12.5px] leading-[18px] hover:underline">
                    {brands.length ? <span className="text-soft">DZ : {brands.join(", ")}{status && status !== "enregistre" ? ` (${AVAILABILITY_LABEL[status]})` : ""}</span>
                      : status ? <span className="text-caution">DZ : {AVAILABILITY_LABEL[status]}</span> : <span className="text-muted">DZ : the app lists the registered products of this INN</span>}
                  </button>
                  <TagLine id={m.id} evidence={m.evidence} strength={m.strength} />
                </>
              )}
            </Row>
          </div>
        );
      })}
      <AddButton onClick={() => { const m = blankMedication(newId("med")); o.insert(items.length, m); setFocus(m.id); }}>medication</AddButton>
    </div>
  );
}

/** Steps top to bottom from the start, each before the ones it leads to (the app's order); unreached ones last. */
function steps(p: Pathway): PathwayNode[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const out: PathwayNode[] = [];
  const seen = new Set<string>();
  const queue = p.start_node_id && byId.has(p.start_node_id) ? [p.start_node_id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id)!);
    for (const b of byId.get(id)!.branches) if (b.next_node_id && byId.has(b.next_node_id)) queue.push(b.next_node_id);
  }
  return [...out, ...p.nodes.filter((n) => !seen.has(n.id))];
}

/**
 * The decision tree as the app shows it, built in place: numbered steps, each with its question, its lines and its
 * answers; an answer leads to a step, or "+ new step" makes the next one and links it.
 */
function PathwayCard({ p, onChange }: { p: Pathway; onChange: (p: Pathway) => void }) {
  const { newId } = useContext(EnvCtx);
  const { focus, setFocus } = useContext(ActiveCtx);
  const ro = useContext(ReadOnlyCtx);
  const list = steps(p);
  const step = new Map(list.map((n, i) => [n.id, i + 1]));
  // the tree's problems, worded with step numbers instead of node ids
  const problems = pathwayProblems(p).map((x) => ({
    ...x, message: x.message.replace(/(?:[Nn]ode|Start node|End node) "([^"]+)"/g, (m, id: string) => (step.has(id) ? `step ${step.get(id)}` : m)).replace(/leads to "([^"]+)"/, "leads to a deleted step").replace(/^./, (c) => c.toUpperCase()),
  }));
  const blank = (): PathwayNode => ({ id: newId("n"), type: "decision", question: "", branches: [], items: [] });
  const setNode = (n: PathwayNode) => onChange({ ...p, nodes: p.nodes.map((x) => (x.id === n.id ? n : x)) });
  const addStep = () => { const n = blank(); onChange({ ...p, nodes: [...p.nodes, n], start_node_id: p.start_node_id ?? n.id }); setFocus(n.id); };
  const removeStep = (id: string) => {
    const nodes = p.nodes.filter((n) => n.id !== id).map((n) => ({ ...n, branches: n.branches.map((b) => (b.next_node_id === id ? { ...b, next_node_id: null } : b)) }));
    onChange({ ...p, nodes, start_node_id: p.start_node_id === id ? nodes[0]?.id ?? null : p.start_node_id });
  };
  const nextBranchId = (n: PathwayNode) => `b${n.branches.reduce((m, b) => Math.max(m, Number(b.id.replace(/\D/g, "")) || 0), 0) + 1}`;

  return (
    <div className={CARD}>
      <p className="pb-[2px] text-[15px] font-bold text-ink">Arbre de décision</p>
      {!list.length && <p className="py-2 text-[13px] text-muted">No tree yet: start with the first question.</p>}
      {problems.filter((x) => !x.node_id).map((x, k) => <p key={k} className="text-[12px] font-medium text-caution">⚠ {x.message}</p>)}
      {list.map((n, i) => {
        const own = problems.filter((x) => x.node_id === n.id);
        const isStart = p.start_node_id === n.id;
        return (
          <div key={n.id} id={`line-${n.id}`} className={`group/node flex scroll-mt-36 flex-col gap-2 py-3 ${i ? "border-t border-line" : ""}`}>
            <div className="flex items-start gap-3">
              <span className={`grid size-[26px] shrink-0 place-items-center rounded-full text-[12.5px] font-bold text-accentink ${n.type === "end" ? "bg-panel" : "bg-tint"}`}>{i + 1}</span>
              <div className="min-w-0 flex-1 pt-[1px]">
                <Inline value={n.question} focusMe={focus === n.id} placeholder={n.type === "end" ? "Fin" : n.type === "action" ? "Titre de l'étape (facultatif)" : "Question…"}
                  onChange={(v) => setNode({ ...n, question: v || null })} className="text-[14.5px] font-semibold leading-[21px] text-ink" />
              </div>
              {!ro && <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/node:opacity-100">
                <select value={n.type} title="Step type" className="h-6 rounded-md bg-panel px-1 text-[11px] text-soft"
                  onChange={(e) => setNode({ ...n, type: e.target.value as PathwayNode["type"], branches: e.target.value === "end" ? [] : n.branches })}>
                  <option value="decision">question</option><option value="action">action</option><option value="end">end</option>
                </select>
                <button type="button" className="h-6 rounded-md px-1.5 text-[11px] text-soft hover:bg-panel"
                  onClick={() => { const it = blankItem(newId("it")); setNode({ ...n, items: [...n.items, it] }); setFocus(it.id); }}>+ line</button>
                {!isStart && <button type="button" className="h-6 rounded-md px-1.5 text-[11px] text-soft hover:bg-panel" onClick={() => onChange({ ...p, start_node_id: n.id })}>Make start</button>}
                <button type="button" className={`${tool} hover:text-flag`} title="Delete the step" onClick={() => removeStep(n.id)}>✕</button>
              </div>}
            </div>
            {own.map((x, k) => <p key={k} className="ps-[38px] text-[12px] font-medium text-caution">⚠ {x.message}</p>)}
            {n.items.length > 0 && (
              <div className="ps-[38px]">
                <ItemList items={n.items} add="line in this step" onChange={(items) => setNode({ ...n, items })} />
              </div>
            )}
            {n.type !== "end" && (
              <div className="flex flex-col gap-[6px] ps-[38px]">
                {n.branches.map((b, k) => {
                  const setB = (patch: Partial<typeof b>) => setNode({ ...n, branches: n.branches.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                  const broken = !b.next_node_id || !step.has(b.next_node_id);
                  return (
                    <div key={b.id} className="group/branch flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-branch bg-panel px-3 py-[6px]">
                      <div className="min-w-0 flex-[1_1_9rem]"><Inline value={b.label} placeholder="Réponse…" onChange={(label) => setB({ label })} className="text-[13.5px] font-medium leading-[19px] text-ink" /></div>
                      <span className="text-[13px] font-bold text-accent">→</span>
                      <select value={b.next_node_id && step.has(b.next_node_id) ? b.next_node_id : ""} disabled={ro}
                        className={`min-w-0 max-w-[calc(100%-1.5rem)] truncate sm:max-w-48 disabled:appearance-none rounded-md bg-transparent py-0.5 text-[13px] font-semibold hover:bg-surface ${broken ? "text-caution" : "text-accentink"}`}
                        onChange={(e) => {
                          if (e.target.value !== "__new") return setB({ next_node_id: e.target.value || null });
                          const m = blank();
                          onChange({ ...p, nodes: [...p.nodes.map((x) => (x.id === n.id ? { ...n, branches: n.branches.map((y, j) => (j === k ? { ...y, next_node_id: m.id } : y)) } : x)), m] });
                          setFocus(m.id);
                        }}>
                        <option value="">choose…</option>
                        {list.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>étape {step.get(x.id)}{x.question ? ` · ${x.question.slice(0, 40)}` : ""}</option>)}
                        <option value="__new">+ new step</option>
                      </select>
                      {!ro && <button type="button" className={`${tool} opacity-0 hover:text-flag group-hover/branch:opacity-100`} title="Delete the answer"
                        onClick={() => setNode({ ...n, branches: n.branches.filter((_, j) => j !== k) })}>✕</button>}
                    </div>
                  );
                })}
                <AddButton onClick={() => setNode({ ...n, branches: [...n.branches, { id: nextBranchId(n), label: "", next_node_id: null }] })}>answer</AddButton>
              </div>
            )}
          </div>
        );
      })}
      <AddButton onClick={addStep}>{list.length ? "step" : "first question"}</AddButton>
    </div>
  );
}

function ReferList({ items, onChange }: { items: Referral[]; onChange: (v: Referral[]) => void }) {
  const { newId } = useContext(EnvCtx);
  const { focus, setFocus } = useContext(ActiveCtx);
  const o = ops(items, onChange);
  const ro = useContext(ReadOnlyCtx);
  return (
    <div className={CARD}>
      <p className="pb-[2px] text-[15px] font-bold text-ink">Orienter</p>
      {items.map((r, i) => (
        <Row key={r.id} line={r} first={i === 0} canUp={i > 0} canDown={i < items.length - 1} onMove={(d) => o.move(i, d)} onDelete={() => o.del(i)}
          details={<ReferralDetails r={r} onChange={(v) => o.set(i, v)} />}>
          <div className="flex items-baseline gap-1 text-[13px] leading-[18px] text-soft">
            <span>Si</span><Inline value={r.criteria} focusMe={focus === r.id} placeholder="critères" onChange={(criteria) => o.set(i, { ...r, criteria })} />
          </div>
          <div className="flex flex-wrap items-baseline gap-1 text-[14.5px] leading-[21px] text-ink">
            <b className="font-bold">Adressez</b>
            <select value={r.urgency ?? ""} disabled={ro} onChange={(e) => o.set(i, { ...r, urgency: (e.target.value || null) as Urgency | null })}
              className={`rounded-md disabled:appearance-none bg-transparent font-bold hover:bg-panel/70 ${r.urgency ? "text-ink" : "text-caution"}`}>
              <option value="">{TO_FILL}</option>
              {Object.entries(URGENCY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span>:</span>
            <div className="min-w-40 flex-1"><Inline value={r.destination} placeholder="destination (facultatif)" onChange={(v) => o.set(i, { ...r, destination: v || null })} /></div>
          </div>
          <TagLine id={r.id} evidence={r.evidence} strength={r.strength} />
        </Row>
      ))}
      <AddButton onClick={() => { const r: Referral = { id: newId("ref"), criteria: "", urgency: null, destination: null, strength: null, evidence: [] }; o.insert(items.length, r); setFocus(r.id); }}>referral</AddButton>
    </div>
  );
}

function FollowList({ items, onChange }: { items: FollowUp[]; onChange: (v: FollowUp[]) => void }) {
  const { newId } = useContext(EnvCtx);
  const { focus, setFocus } = useContext(ActiveCtx);
  const o = ops(items, onChange);
  const addAt = (k: number) => { const x: FollowUp = { id: newId("fu"), when: "", what: "", evidence: [] }; o.insert(k, x); setFocus(x.id); };
  return (
    <div className={CARD}>
      <p className="pb-[2px] text-[15px] font-bold text-ink">Suivre</p>
      <div className="flex border-b border-line pb-2 pt-1 text-[12px] font-bold uppercase text-muted"><span className="w-[30%] pe-3">Quand</span><span>Quoi</span></div>
      {items.map((x, i) => (
        <Row key={x.id} line={x} first={i === 0} canUp={i > 0} canDown={i < items.length - 1} onMove={(d) => o.move(i, d)} onDelete={() => o.del(i)}
          details={<FollowUpDetails f={x} onChange={(v) => o.set(i, v)} />}>
          <div className="flex">
            <div className="w-[30%] pe-3"><Inline value={x.when} focusMe={focus === x.id} placeholder="J7" onChange={(when) => o.set(i, { ...x, when })} className="text-[14px] font-semibold leading-5 text-ink" /></div>
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <Inline value={x.what} onChange={(what) => o.set(i, { ...x, what })} onEnter={() => addAt(i + 1)} className="text-[14px] leading-5 text-ink" />
              <TagLine id={x.id} evidence={x.evidence} strength={null} />
            </div>
          </div>
        </Row>
      ))}
      <AddButton onClick={() => addAt(items.length)}>follow-up</AddButton>
    </div>
  );
}

type Edit = (fn: (d: Protocol) => void) => void;
type SectionId = "red_box" | "assess" | "treat" | "advise" | "refer_follow" | "sources";
const ORDER: Record<Protocol["meta"]["template"], SectionId[]> = {
  urgence: ["red_box", "assess", "treat", "advise", "refer_follow", "sources"],
  pathologie: ["red_box", "assess", "advise", "treat", "refer_follow", "sources"],
};

/** The whole fiche as published, editable: header, then the sections in the template's order. */
export function FichePreview({ f, edit, stat, readOnly = false }: { f: Protocol; edit: Edit; stat: (section: string) => { count: number; done: number }; readOnly?: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const urgent = f.meta.template === "urgence";

  const body = (s: SectionId) => {
    switch (s) {
      case "red_box":
        return <RedBox f={f} edit={edit} />;
      case "assess":
        return (
          <>
            <Card title="Signes et symptômes"><ItemList items={f.assess.symptoms} add="symptom" onChange={(v) => edit((d) => void (d.assess.symptoms = v))} /></Card>
            <Card title="Demander"><ItemList items={f.assess.ask} add="question to ask" onChange={(v) => edit((d) => void (d.assess.ask = v))} /></Card>
            <Card title="Examiner"><ItemList items={f.assess.examine} add="sign to examine" onChange={(v) => edit((d) => void (d.assess.examine = v))} /></Card>
            <Card title="Confirmation diagnostique"><ItemList items={f.assess.diagnosis} add="diagnostic criterion" onChange={(v) => edit((d) => void (d.assess.diagnosis = v))} /></Card>
            <Card title="Examens complémentaires"><ItemList items={f.assess.tests} add="test" onChange={(v) => edit((d) => void (d.assess.tests = v))} /></Card>
            <PathwayCard p={f.assess.pathway} onChange={(p) => edit((d) => void (d.assess.pathway = p))} />
          </>
        );
      case "treat":
        return (
          <>
            <MedicationList items={f.treat.medications} onChange={(v) => edit((d) => void (d.treat.medications = v))} />
            <Card title="Autres mesures"><ItemList items={f.treat.actions} add="measure" onChange={(v) => edit((d) => void (d.treat.actions = v))} /></Card>
            <div className="rounded-card bg-flagbg px-[18px] pb-[6px] pt-4">
              <p className="flex items-center gap-2 pb-[2px] text-[15px] font-bold text-flag"><span aria-hidden>⚠</span>À ne pas faire</p>
              <ItemList items={f.treat.do_not} rule="border-flag/10" add="do-not" onChange={(v) => edit((d) => void (d.treat.do_not = v))} />
            </div>
          </>
        );
      case "advise":
        return <Card><ItemList items={f.advise} add="advice" onChange={(v) => edit((d) => void (d.advise = v))} /></Card>;
      case "refer_follow":
        return (
          <>
            <ReferList items={f.refer_follow.refer} onChange={(v) => edit((d) => void (d.refer_follow.refer = v))} />
            <FollowList items={f.refer_follow.follow_up} onChange={(v) => edit((d) => void (d.refer_follow.follow_up = v))} />
          </>
        );
      case "sources":
        return (
          <Card>
            {f.sources.map((s, i) => (
              <div key={s.id} className={`flex flex-col gap-1 py-3 ${i ? "border-t border-line" : ""}`}>
                <p className="text-[13px] font-bold text-ink">{s.organisation || TO_FILL}</p>
                <p className="text-[13.5px] leading-[19px] text-ink">{s.title}</p>
                <p className="text-[12px] leading-[17px] text-soft">{s.citation}</p>
              </div>
            ))}
            {!readOnly && <button type="button" className="py-2 text-[13px] font-semibold text-accent hover:underline"
              onClick={() => document.getElementById("section-sources")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Edit sources ↓</button>}
          </Card>
        );
    }
  };

  return (
    <ReadOnlyCtx.Provider value={readOnly}>
    <ActiveCtx.Provider value={{ active, setActive, focus, setFocus }}>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7">
        <div className="flex flex-col gap-3">
          <Inline value={f.meta.title} placeholder="Titre de la fiche" onChange={(title) => edit((d) => void (d.meta.title = title))} className="text-[24px] font-bold leading-[29px] tracking-[-0.5px] text-ink" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
            <select value={f.meta.template} disabled={readOnly} onChange={(e) => edit((d) => void (d.meta.template = e.target.value as Protocol["meta"]["template"]))}
              className={`rounded-md bg-transparent hover:bg-panel/70 disabled:appearance-none ${urgent ? "font-semibold text-flag" : "text-soft"}`}>
              <option value="urgence">Urgence</option><option value="pathologie">Pathologie</option>
            </select>
            {!urgent && <div className="w-40"><Inline value={f.meta.specialite} placeholder="spécialité" onChange={(v) => edit((d) => void (d.meta.specialite = v))} className="text-soft" /></div>}
          </div>
          <Inline value={f.scope.population} placeholder="population (ex. Adultes)" onChange={(v) => edit((d) => void (d.scope.population = v || null))} className="text-[13px] leading-[19px] text-soft" />
        </div>
        {ORDER[f.meta.template].map((s) => {
          const { count, done } = stat(s);
          return (
            <section key={s} id={`section-${s}`} className="flex scroll-mt-32 flex-col gap-3">
              {s !== "red_box" && (
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[17px] font-semibold leading-[22px] text-ink">{SECTION_TITLE[s]}</h2>
                  {count > 0 && !readOnly && <span className={`text-xs tabular-nums ${done === count ? "text-accent" : "text-muted"}`}>{done}/{count} checked</span>}
                </div>
              )}
              {body(s)}
            </section>
          );
        })}
      </div>
    </ActiveCtx.Provider>
    </ReadOnlyCtx.Provider>
  );
}
