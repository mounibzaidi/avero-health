"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, inputCls, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";

/** One selected passage of the guideline: its printed page and the exact selected text. */
export interface Part { page: number; text: string }
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
  { key: "2", label: "Signes typiques", target: { section: "2_presentation", place: "signes_typiques" } },
  { key: "3", label: "Gravité", target: { section: "4_gravite", place: "signes_de_gravite" } },
  { key: "4", label: "Conduite (nœud)", target: { section: "5_conduite", place: "node" } },
  { key: "5", label: "Examens", target: { section: "6_examens", place: "elements" } },
  { key: "6", label: "Traitement", target: { section: "7_traitement", place: "elements" } },
  { key: "7", label: "Posologie", target: { section: "7_traitement", place: "posologies" } },
  { key: "8", label: "Ne pas faire", target: { section: "8_ne_pas_faire", place: "elements" } },
  { key: "9", label: "Orientation", target: { section: "9_orientation", place: "elements" } },
];
/** Every target, for the menu. */
export const TARGETS: { label: string; target: Target }[] = [
  ...KEYS.map((k) => ({ label: k.label, target: k.target })),
  { label: "Formes trompeuses", target: { section: "2_presentation", place: "formes_trompeuses" } },
  { label: "Examen clinique", target: { section: "2_presentation", place: "examen_clinique" } },
  { label: "Gestes immédiats", target: { section: "4_gravite", place: "gestes_immediats" } },
  { label: "Champ", target: { section: "3_champ", place: "elements" } },
  { label: "Contre-indications", target: { section: "7_traitement", place: "contre_indications" } },
  { label: "Surveillance", target: { section: "10_surveillance", place: "elements" } },
  { label: "Suivi", target: { section: "11_suivi", place: "elements" } },
  { label: "Définitions", target: { section: "13_definitions", place: "elements" } },
];
const key = (t: Target) => `${t.section}|${t.place}`;
const labelOf = (t: Target) => TARGETS.find((x) => key(x.target) === key(t))?.label ?? `${t.section} · ${t.place}`;
const SECTION_FOR_PLACEMENT: Record<string, Target> = {
  "8_ne_pas_faire": { section: "8_ne_pas_faire", place: "elements" },
  "6_examens": { section: "6_examens", place: "elements" },
};

const FIELD_LABEL: Record<string, string> = { text: "texte", drug_dci: "DCI", dose: "dose", route: "voie", frequency_or_duration: "fréquence / durée" };

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * Select-to-add: the passages selected in the guideline, the target (number keys 1-9 or the menu), a card with the
 * defined fields to type (Haiku pre-fills them only when asked), and the code checks. Keys: A adds the selection as
 * another passage, 1-9 opens the card for that target, Enter (Ctrl+Enter inside a field) accepts, E edits, Esc discards.
 */
export function Composer({ draftId, selection, nodes, onAccept, onShow }: {
  draftId: string;
  selection: Part | null;
  nodes: string[];
  onAccept: (target: Target, line: Proposal["line"]) => Promise<void>;
  onShow: (p: Part) => void;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [target, setTarget] = useState<Target>(KEYS[5].target);
  const [node, setNode] = useState<number>(-1);  // -1: a new node
  const [nodeLabel, setNodeLabel] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState(false);  // Haiku pre-fills the fields (paid); off: empty fields to type
  const textRef = useRef<HTMLTextAreaElement>(null);
  const firstDoseRef = useRef<HTMLInputElement>(null);

  const withSelection = useCallback((): Part[] => {
    if (!selection) return parts;
    return parts.some((p) => p.page === selection.page && p.text === selection.text) ? parts : [...parts, selection];
  }, [parts, selection]);

  const propose = useCallback(async (t: Target) => {
    const ps = withSelection();
    if (!ps.length) return setError("Sélectionnez d'abord un passage dans le PDF ou le texte");
    const full: Target = t.place === "node" ? { ...t, node: node >= 0 ? node : nodes.length, node_label: node >= 0 ? nodes[node] : nodeLabel.trim() || "Conduite" } : t;
    setTarget(t);
    setParts(ps);
    setBusy(true);
    setError(null);
    try {
      const p = await api<Proposal>(`/fichegen/drafts/${draftId}/propose`, { method: "POST", body: JSON.stringify({ target: full, parts: ps, fill }) });
      // rule 4: the line goes where the rule puts it, unless the reviewer keeps the chosen place
      setProposal(p.placement ? { ...p, target: { ...(SECTION_FOR_PLACEMENT[p.placement.section] ?? { section: p.placement.section, place: p.placement.place }) } } : { ...p, target: full });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draftId, withSelection, node, nodes, nodeLabel, fill]);
  // a new card: straight into its first field, to type
  useEffect(() => {
    if (!proposal) return;
    const el = proposal.target.place === "posologies" ? firstDoseRef.current : textRef.current;
    el?.focus();
  }, [proposal?.line.source.quote, proposal?.target.place]);  // eslint-disable-line react-hooks/exhaustive-deps

  const empty = proposal && (proposal.target.place === "posologies"
    ? ["drug_dci", "dose", "route", "frequency_or_duration"].filter((k) => !String(proposal.line[k] ?? "").trim())
    : ["text"].filter((k) => !String(proposal.line[k] ?? "").trim()));
  const blockedBy = proposal && (proposal.quote_status === "failed" ? "citation introuvable sur sa page"
    : empty && empty.length ? `à remplir : ${empty.map((k) => FIELD_LABEL[k]).join(", ")}`
    : proposal.problems.length ? `non conforme : ${proposal.problems[0]}` : null);
  // rule 4 on what the reviewer typed: a do-not line belongs in Ne pas faire
  const donot = proposal && proposal.target.section !== "8_ne_pas_faire" && /^\s*(ne (pas|jamais)|pas d[e']|éviter|ne doit pas)\b/i.test(String(proposal.line.text ?? ""));
  const accept = useCallback(async () => {
    if (!proposal || blockedBy) return;
    setBusy(true);
    try {
      await onAccept(proposal.target, proposal.line);
      setProposal(null);
      setParts([]);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [proposal, blockedBy, onAccept]);
  const discard = () => { setProposal(null); setParts([]); setError(null); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { (document.activeElement as HTMLElement | null)?.blur(); discard(); return; }
      // accept while typing: Ctrl/⌘+Enter anywhere, Enter in a one-line field of the card
      if (e.key === "Enter" && proposal && (e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.tagName === "INPUT")) { e.preventDefault(); void accept(); return; }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const k = KEYS.find((x) => x.key === e.key);
      if (k) { e.preventDefault(); void propose(k.target); return; }
      if (e.key === "Enter" && proposal) { e.preventDefault(); void accept(); return; }
      if ((e.key === "e" || e.key === "E") && proposal) { e.preventDefault(); textRef.current?.focus(); return; }
      if ((e.key === "a" || e.key === "A") && selection) { e.preventDefault(); setParts(withSelection()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, proposal, propose, accept, selection, withSelection]);

  const set = (patch: Record<string, unknown>) => proposal && setProposal({ ...proposal, line: { ...proposal.line, ...patch } });
  const field = (label: string, k: string, wide = false) => (
    <label className={`flex flex-col gap-0.5 ${wide ? "col-span-2" : ""}`}>
      <span className="text-[11px] text-muted">{label}</span>
      <input className={`${inputCls} h-8`} value={String(proposal?.line[k] ?? "")} onChange={(e) => set({ [k]: e.target.value || null })} />
    </label>
  );
  const shownParts = proposal ? parts : withSelection();
  const isDose = proposal?.target.place === "posologies";

  return (
    <div className="flex max-h-[55%] flex-col gap-2 overflow-auto border-t border-line bg-surface p-3 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.25)]">
      <div className="flex flex-wrap items-center gap-1.5">
        {KEYS.map((k) => (
          <button key={k.key} type="button" disabled={busy} onClick={() => void propose(k.target)}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs ${key(k.target) === key(target) ? "border-accent/40 bg-tint text-accentink" : "border-line text-soft hover:bg-panel"}`}>
            <kbd className="rounded bg-panel px-1 font-mono text-[10px] text-muted">{k.key}</kbd>{k.label}
          </button>
        ))}
        <select className={`${inputCls} h-7 text-xs`} value={key(target)} onChange={(e) => { const t = TARGETS.find((x) => key(x.target) === e.target.value)?.target; if (t) setTarget(t); }}>
          {TARGETS.map((t) => <option key={key(t.target)} value={key(t.target)}>{t.label}</option>)}
        </select>
        <label className="ms-auto flex items-center gap-1 text-xs text-muted" title="Haiku remplit les champs (≈ 0,0003 $ la ligne)">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Pré-remplir (IA)
        </label>
        {target.place === "node" && (
          <>
            <select className={`${inputCls} h-7 text-xs`} value={node} onChange={(e) => setNode(Number(e.target.value))}>
              {nodes.map((n, i) => <option key={i} value={i}>{n}</option>)}
              <option value={-1}>Nouveau nœud…</option>
            </select>
            {node < 0 && <input className={`${inputCls} h-7 w-44 text-xs`} placeholder="Libellé du nœud" value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} />}
          </>
        )}
      </div>

      {shownParts.length === 0 ? (
        <p className="text-xs text-muted">Sélectionnez un passage à gauche, puis une touche <kbd className="font-mono">1</kbd>–<kbd className="font-mono">9</kbd> (ou la cible) : remplissez les champs, <kbd className="font-mono">Ctrl+Entrée</kbd> pour ajouter. <kbd className="font-mono">A</kbd> ajoute un autre passage à la même ligne.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {shownParts.map((p, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md bg-panel/60 px-2 py-1 text-xs">
              <button type="button" className="shrink-0 font-medium text-accentink hover:underline" onClick={() => onShow(p)}>p. {p.page}</button>
              <span className="min-w-0 flex-1 italic text-ink">« {p.text.length > 260 ? `${p.text.slice(0, 260)}…` : p.text} »</span>
              {proposal?.part_status[i] && <Tag tone={proposal.part_status[i] === "failed" ? "urgent" : "accent"}>{proposal.part_status[i] === "failed" ? "introuvable" : "trouvé"}</Tag>}
              {!proposal && parts.includes(p) && <button type="button" className="text-muted hover:text-flag" onClick={() => setParts(parts.filter((x) => x !== p))}>✕</button>}
              {!proposal && !parts.includes(p) && <span className="shrink-0 text-muted">sélection</span>}
            </li>
          ))}
        </ol>
      )}

      {busy && <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" /> {fill ? "Haiku remplit la ligne…" : "Vérification…"}</p>}
      {error && <p className="text-xs text-flag">{error}</p>}

      {proposal && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-tint/30 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-medium text-ink">→ {labelOf(proposal.target)}{proposal.target.place === "node" ? ` · ${proposal.target.node_label}` : ""}</span>
            <Tag tone={proposal.quote_status === "failed" ? "urgent" : proposal.quote_status === "parsed" ? "caution" : "accent"}>
              {proposal.quote_status === "failed" ? "citation introuvable" : proposal.quote_status === "parsed" ? "citation (texte parsé)" : "citation vérifiée"}</Tag>
            {proposal.grade_source && <Tag>{String(proposal.line.grade)}{proposal.grade_source === "page" ? " (lu sur la page)" : " (modèle)"}</Tag>}
            {proposal.placement && (
              <span className="text-caution">
                Déplacée par la {proposal.placement.why}{" "}
                <button type="button" className="underline" onClick={() => setProposal({ ...proposal, target: { ...target, ...(target.place === "node" ? { node: node >= 0 ? node : nodes.length, node_label: node >= 0 ? nodes[node] : nodeLabel.trim() || "Conduite" } : {}) }, placement: null })}>
                  garder en {labelOf(target)}</button>
              </span>
            )}
            {proposal.duplicate && <Tag tone="caution">doublon possible : {proposal.duplicate.section} {proposal.duplicate.id ?? ""}</Tag>}
            {proposal.nomenclature && (
              <Tag tone={proposal.nomenclature.registered ? "accent" : "caution"}>
                Nomenclature : {proposal.nomenclature.brands ? `${proposal.nomenclature.brands} marque(s), ${proposal.nomenclature.registered} enregistrée(s)` : "aucune présentation trouvée"}</Tag>
            )}
          </div>
          {isDose ? (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted">DCI</span>
                <input ref={firstDoseRef} className={`${inputCls} h-8`} value={String(proposal.line.drug_dci ?? "")} onChange={(e) => set({ drug_dci: e.target.value })} />
              </label>
              {field("Dose", "dose")}{field("Dose max", "dose_max")}{field("Voie", "route")}
              {field("Fréquence / durée", "frequency_or_duration", true)}{field("Condition", "condition", true)}
            </div>
          ) : (
            <>
              <textarea ref={textRef} rows={2} className={`${inputCls} h-auto py-1.5`} value={String(proposal.line.text ?? "")} onChange={(e) => set({ text: e.target.value })} />
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Type</span>
                  <select className={`${inputCls} h-8`} value={String(proposal.line.type)} onChange={(e) => set({ type: e.target.value })}>
                    {["action", "conditional", "info", "row"].map((t) => <option key={t}>{t}</option>)}</select></label>
                <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Risque</span>
                  <select className={`${inputCls} h-8`} value={String(proposal.line.risk)} onChange={(e) => set({ risk: e.target.value })}>
                    {["high", "medium", "low"].map((t) => <option key={t}>{t}</option>)}</select></label>
                {field("Grade", "grade")}{field("Condition", "condition")}
              </div>
            </>
          )}
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted">Manquant (un par ligne : ce que la citation ne donne pas)</span>
            <textarea rows={1} className={`${inputCls} h-auto py-1`} value={(proposal.line.missing as string[]).join("\n")}
              onChange={(e) => set({ missing: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
          </label>
          {donot && <p className="text-xs text-caution">Règle 4 : une consigne « ne pas faire » va dans Ne pas faire.{" "}
            <button type="button" className="underline" onClick={() => setProposal({ ...proposal, target: { section: "8_ne_pas_faire", place: "elements" } })}>Déplacer</button></p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" className="h-8" disabled={busy || !!blockedBy} onClick={() => void accept()}>Ajouter <kbd className="font-mono text-[10px] opacity-70">Ctrl+Entrée</kbd></Button>
            <Button className="h-8" onClick={() => textRef.current?.focus()} disabled={isDose}>Modifier <kbd className="font-mono text-[10px] opacity-70">E</kbd></Button>
            <Button variant="ghost" className="h-8" onClick={discard}>Annuler <kbd className="font-mono text-[10px] opacity-70">Échap</kbd></Button>
            {blockedBy && <span className="text-xs text-flag">Bloqué : {blockedBy}{proposal.quote_status === "failed" ? " (sélectionnez dans l'onglet Texte)" : ""}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
