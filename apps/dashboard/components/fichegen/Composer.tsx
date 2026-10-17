"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { inputCls, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

/** One selected passage of the guideline: its printed page, the exact text, the drug of its dose-table row. */
export interface Part { page: number; text: string; drug?: string | null }
/** Where a new line goes: a section's list, a 5_conduite node (index, or a new one with its label), or the doses. */
export interface Target { section: string; place: string; node?: number; node_label?: string }
export interface Proposal {
  line: Record<string, unknown> & { source: { page: number; quote: string } };
  target: Target; quote_status: "pdf" | "parsed" | "failed"; part_status: string[]; grade_source: "page" | "model" | null;
  placement: { section: string; place: string; why: string } | null;
  duplicate: { id: string | null; section: string; text: string } | null;
  problems: string[];
  nomenclature: { dci: string; brands: number; registered: number; statut: string | null } | null;
}

/** Number keys: the most-used targets. */
export const KEYS: { key: string; label: string; target: Target }[] = [
  { key: "1", label: "Essentiel", target: { section: "1_essentiel", place: "elements" } },
  { key: "2", label: "Signes", target: { section: "2_presentation", place: "signes_typiques" } },
  { key: "3", label: "Gravité", target: { section: "4_gravite", place: "signes_de_gravite" } },
  { key: "4", label: "Conduite", target: { section: "5_conduite", place: "node" } },
  { key: "5", label: "Examens", target: { section: "6_examens", place: "elements" } },
  { key: "6", label: "Traitement", target: { section: "7_traitement", place: "elements" } },
  { key: "7", label: "Posologie", target: { section: "7_traitement", place: "posologies" } },
  { key: "8", label: "Ne pas faire", target: { section: "8_ne_pas_faire", place: "elements" } },
  { key: "9", label: "Orientation", target: { section: "9_orientation", place: "elements" } },
];
const MORE: { label: string; target: Target }[] = [
  { label: "Formes trompeuses", target: { section: "2_presentation", place: "formes_trompeuses" } },
  { label: "Examen clinique", target: { section: "2_presentation", place: "examen_clinique" } },
  { label: "Gestes immédiats", target: { section: "4_gravite", place: "gestes_immediats" } },
  { label: "Champ", target: { section: "3_champ", place: "elements" } },
  { label: "Contre-indications", target: { section: "7_traitement", place: "contre_indications" } },
  { label: "Surveillance", target: { section: "10_surveillance", place: "elements" } },
  { label: "Suivi", target: { section: "11_suivi", place: "elements" } },
  { label: "Définitions", target: { section: "13_definitions", place: "elements" } },
];
const ALL = [...KEYS.map((k) => ({ label: k.label, target: k.target })), ...MORE];
const tkey = (t: Target) => `${t.section}|${t.place}`;
const labelOf = (t: Target) => ALL.find((x) => tkey(x.target) === tkey(t))?.label ?? t.section;
const FIELD_LABEL: Record<string, string> = { text: "texte", drug_dci: "DCI", dose: "dose", route: "voie", frequency_or_duration: "fréquence / durée" };
const DONOT = /^\s*(ne (pas|jamais)|pas d[e']|éviter|ne doit pas)\b/i;

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-edge/15 bg-surface px-1 font-mono text-[10px] leading-4 text-muted shadow-[0_1px_0_rgba(0,0,0,0.06)]">{children}</kbd>;
}

/**
 * Select-to-add: the passage (selected text or a clicked guide row), the target (keys 1-9, Enter for the last one),
 * and a card with the defined fields, pre-filled by code with what the text says for sure (Haiku only when ticked).
 * Keys: 1-9 open the card, Enter reuses the last target, A adds another passage, Ctrl+Enter adds the line, Esc cancels.
 */
export function Composer({ draftId, selection, nodes, onAccept, onShow, onNext }: {
  draftId: string;
  onNext: () => void;
  selection: Part | null;
  nodes: string[];
  onAccept: (target: Target, line: Proposal["line"]) => Promise<void>;
  onShow: (p: Part) => void;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [last, setLast] = useState<Target>(KEYS[5].target);
  const [node, setNode] = useState<number>(-1);
  const [nodeLabel, setNodeLabel] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const doseRef = useRef<HTMLInputElement>(null);

  const withSelection = useCallback((): Part[] => {
    if (!selection) return parts;
    return parts.some((p) => p.page === selection.page && p.text === selection.text) ? parts : [...parts, selection];
  }, [parts, selection]);

  const propose = useCallback(async (t: Target) => {
    const ps = withSelection();
    if (!ps.length) return setError("Sélectionnez un passage ou cliquez une ligne du guide");
    const full: Target = t.place === "node" ? { ...t, node: node >= 0 ? node : nodes.length, node_label: node >= 0 ? nodes[node] : nodeLabel.trim() || "Conduite" } : t;
    setLast(t);
    setParts(ps);
    setBusy(true);
    setError(null);
    try {
      const p = await api<Proposal>(`/fichegen/drafts/${draftId}/propose`, { method: "POST", body: JSON.stringify({ target: full, parts: ps, fill }) });
      setProposal(p.placement ? { ...p, target: { section: p.placement.section, place: p.placement.place === "node:0" ? "elements" : p.placement.place } } : { ...p, target: full });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draftId, withSelection, node, nodes, nodeLabel, fill]);

  useEffect(() => {
    if (!proposal) return;
    (proposal.target.place === "posologies" ? doseRef.current : textRef.current)?.focus();
  }, [proposal?.line.source.quote, proposal?.target.place]);  // eslint-disable-line react-hooks/exhaustive-deps

  const isDose = proposal?.target.place === "posologies";
  const empty = proposal ? (isDose ? ["drug_dci", "dose", "route", "frequency_or_duration"] : ["text"]).filter((k) => !String(proposal.line[k] ?? "").trim()) : [];
  const blockedBy = proposal && (proposal.quote_status === "failed" ? "citation introuvable sur sa page (sélectionnez dans l'onglet Texte)"
    : empty.length ? `à remplir : ${empty.map((k) => FIELD_LABEL[k]).join(", ")}`
    : proposal.problems.length ? `non conforme : ${proposal.problems[0]}` : null);
  const donot = !!proposal && !isDose && proposal.target.section !== "8_ne_pas_faire" && DONOT.test(String(proposal.line.text ?? ""));

  const discard = useCallback(() => { setProposal(null); setParts([]); setError(null); }, []);
  const accept = useCallback(async () => {
    if (!proposal || blockedBy) return;
    setBusy(true);
    try {
      await onAccept(proposal.target, proposal.line);
      discard();
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [proposal, blockedBy, onAccept, discard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { (document.activeElement as HTMLElement | null)?.blur(); discard(); return; }
      if (e.key === "Enter" && proposal && (e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.tagName === "INPUT")) { e.preventDefault(); void accept(); return; }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const k = KEYS.find((x) => x.key === e.key);
      if (k) { e.preventDefault(); void propose(k.target); return; }
      if (e.key === "Enter") { e.preventDefault(); if (proposal) void accept(); else void propose(last); return; }
      if ((e.key === "e" || e.key === "E") && proposal) { e.preventDefault(); (isDose ? doseRef.current : textRef.current)?.focus(); return; }
      if ((e.key === "a" || e.key === "A") && selection && !proposal) { e.preventDefault(); setParts(withSelection()); return; }
      if ((e.key === "n" || e.key === "N") && !proposal) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, proposal, propose, accept, discard, selection, withSelection, last, isDose, onNext]);

  const set = (patch: Record<string, unknown>) => proposal && setProposal({ ...proposal, line: { ...proposal.line, ...patch } });
  const input = (label: string, k: string, ref?: React.Ref<HTMLInputElement>) => (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <input ref={ref} className={`${inputCls} h-8`} value={String(proposal?.line[k] ?? "")} onChange={(e) => set({ [k]: e.target.value || null })} />
    </label>
  );
  const shownParts = proposal ? parts : withSelection();

  return (
    <div className="flex max-h-[58%] flex-col border-t border-line bg-surface shadow-[0_-12px_32px_-24px_rgba(0,0,0,0.35)]">
      {/* targets */}
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2.5">
        {KEYS.map((k) => {
          const on = tkey(k.target) === tkey(proposal?.target ?? last);
          return (
            <button key={k.key} type="button" disabled={busy} onClick={() => void propose(k.target)}
              className={`group flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on ? "border-accent/50 bg-tint font-medium text-accentink" : "border-line text-soft hover:border-edge/25 hover:text-ink"}`}>
              <span className={`font-mono text-[10px] ${on ? "text-accentink" : "text-muted group-hover:text-soft"}`}>{k.key}</span>{k.label}
            </button>
          );
        })}
        <select className="h-7 rounded-full border border-line bg-surface px-2 text-xs text-soft" value=""
          onChange={(e) => { const t = MORE.find((x) => tkey(x.target) === e.target.value)?.target; if (t) void propose(t); }}>
          <option value="">Autre…</option>
          {MORE.map((t) => <option key={tkey(t.target)} value={tkey(t.target)}>{t.label}</option>)}
        </select>
        <label className="ms-auto flex items-center gap-1.5 text-[11px] text-muted" title="Haiku remplit les champs (≈ 0,0003 $ la ligne)">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Pré-remplir (IA)
        </label>
      </div>
      {(last.place === "node" || proposal?.target.place === "node") && (
        <div className="flex items-center gap-2 px-3 pt-2 text-xs">
          <span className="text-muted">Nœud</span>
          <select className={`${inputCls} h-7 text-xs`} value={node} onChange={(e) => setNode(Number(e.target.value))}>
            {nodes.map((n, i) => <option key={i} value={i}>{n}</option>)}
            <option value={-1}>Nouveau nœud…</option>
          </select>
          {node < 0 && <input className={`${inputCls} h-7 w-56 text-xs`} placeholder="ex. STEMI à l'ECG" value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} />}
        </div>
      )}

      <div className="flex min-h-0 flex-col gap-2 overflow-auto p-3">
        {/* passages */}
        {shownParts.length === 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Cliquez une ligne du guide ou sélectionnez un passage, puis <Kbd>1</Kbd>–<Kbd>9</Kbd> ou <Kbd>Entrée</Kbd> ({labelOf(last)}).
            <Kbd>N</Kbd> ligne suivante non couverte · <Kbd>A</Kbd> autre passage pour la même ligne.
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {shownParts.map((p, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border-l-2 border-caution/60 bg-cautionbg/60 px-2.5 py-1.5 text-xs">
                <button type="button" className="shrink-0 font-semibold tabular-nums text-accentink hover:underline" onClick={() => onShow(p)}>p. {p.page}</button>
                <span className="min-w-0 flex-1 text-ink">{p.text.length > 320 ? `${p.text.slice(0, 320)}…` : p.text}</span>
                {proposal?.part_status[i] === "failed" && <span className="shrink-0 font-medium text-flag">introuvable</span>}
                {!proposal && parts.includes(p) && <button type="button" className="text-muted hover:text-flag" onClick={() => setParts(parts.filter((x) => x !== p))}>✕</button>}
              </li>
            ))}
          </ol>
        )}

        {busy && <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" /> {fill ? "Haiku remplit la ligne…" : "Vérification…"}</p>}
        {error && <p className="text-xs text-flag">{error}</p>}

        {/* the card */}
        {proposal && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-edge/10 bg-bg/60 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-ink">{labelOf(proposal.target)}{proposal.target.place === "node" ? ` › ${proposal.target.node_label}` : ""}</span>
              <span className={proposal.quote_status === "failed" ? "text-flag" : "text-accentink"}>
                {proposal.quote_status === "failed" ? "✕ citation introuvable" : "✓ citation vérifiée"}</span>
              {Boolean(proposal.line.grade) && <span className="text-soft">{String(proposal.line.grade)}</span>}
              {proposal.nomenclature && (
                <span className={proposal.nomenclature.registered ? "text-accentink" : "text-caution"}>
                  {proposal.nomenclature.brands ? `Nomenclature : ${proposal.nomenclature.registered}/${proposal.nomenclature.brands} enregistrée(s)` : "Absent de la nomenclature"}</span>
              )}
              {proposal.duplicate && <span className="text-caution">Doublon possible ({proposal.duplicate.section})</span>}
              {proposal.placement && <span className="text-caution">Placée par la {proposal.placement.why}</span>}
            </div>

            {isDose ? (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {input("DCI", "drug_dci", doseRef)}{input("Dose", "dose")}{input("Voie", "route")}{input("Fréquence / durée", "frequency_or_duration")}
              </div>
            ) : (
              <textarea ref={textRef} rows={2} placeholder="La ligne en français, ce que dit la citation et rien de plus"
                className={`${inputCls} h-auto resize-none py-2 text-[13px] leading-snug`} value={String(proposal.line.text ?? "")}
                onChange={(e) => set({ text: e.target.value })} />
            )}

            {details && (
              isDose ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{input("Dose max", "dose_max")}{input("Administration", "administration")}{input("Condition", "condition")}</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {input("Condition", "condition")}{input("Grade", "grade")}
                  <label className="flex flex-col gap-0.5"><span className="text-[11px] font-medium text-muted">Type</span>
                    <select className={`${inputCls} h-8`} value={String(proposal.line.type)} onChange={(e) => set({ type: e.target.value })}>
                      {["action", "conditional", "info", "row"].map((t) => <option key={t}>{t}</option>)}</select></label>
                  <label className="flex flex-col gap-0.5"><span className="text-[11px] font-medium text-muted">Risque</span>
                    <select className={`${inputCls} h-8`} value={String(proposal.line.risk)} onChange={(e) => set({ risk: e.target.value })}>
                      {["high", "medium", "low"].map((t) => <option key={t}>{t}</option>)}</select></label>
                </div>
              )
            )}
            {details && (
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-muted">Manquant (une ligne par élément que la citation ne donne pas)</span>
                <textarea rows={1} className={`${inputCls} h-auto resize-none py-1`} value={(proposal.line.missing as string[]).join("\n")}
                  onChange={(e) => set({ missing: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
              </label>
            )}
            {donot && (
              <p className="text-xs text-caution">Règle 4 : une consigne « ne pas faire » va dans Ne pas faire.{" "}
                <button type="button" className="font-medium underline" onClick={() => setProposal({ ...proposal, target: { section: "8_ne_pas_faire", place: "elements" } })}>Déplacer</button></p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !!blockedBy} onClick={() => void accept()}
                className="inline-flex h-8 items-center gap-2 rounded-button bg-btn px-3 text-sm font-medium text-btnink shadow-control hover:brightness-95 disabled:opacity-50">
                Ajouter <span className="font-mono text-[10px] opacity-70">Ctrl ↵</span>
              </button>
              <button type="button" className="h-8 rounded-button px-2.5 text-sm text-soft hover:bg-panel" onClick={() => setDetails((x) => !x)}>
                {details ? "Moins" : "Détails"}</button>
              <button type="button" className="h-8 rounded-button px-2.5 text-sm text-soft hover:bg-panel" onClick={discard}>Annuler <span className="font-mono text-[10px] opacity-60">Échap</span></button>
              {blockedBy && <span className="text-xs text-flag">{blockedBy}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
