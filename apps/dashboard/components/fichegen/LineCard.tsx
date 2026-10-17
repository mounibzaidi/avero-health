"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { inputCls, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { type Part, type Proposal, type Target, targetLabel } from "@/lib/fichegen";

const FIELD_LABEL: Record<string, string> = { text: "texte", drug_dci: "DCI", dose: "dose", route: "voie", frequency_or_duration: "fréquence / durée" };
const DONOT = /^\s*(ne (pas|jamais)|pas d[e']|éviter|ne doit pas)\b/i;

/**
 * A new line of the fiche, open in its section: the quote (selected in the PDF, a clicked guide row, or pasted, each
 * passage with its printed page), the defined fields pre-filled by code, the checks, and Ajouter. Ctrl+Enter checks
 * then adds; Esc closes.
 */
export function LineCard({ draftId, target: initial, parts: initialParts, nodes, selection, onAccept, onCancel, onShow }: {
  draftId: string;
  target: Target;
  parts: Part[];
  nodes: string[];
  selection: Part | null;  // the current PDF selection, to add as another passage
  onAccept: (target: Target, line: Proposal["line"]) => Promise<void>;
  onCancel: () => void;
  onShow: (p: Part) => void;
}) {
  const [target, setTarget] = useState<Target>(initial);
  const [parts, setParts] = useState<Part[]>(initialParts.length ? initialParts : [{ page: 0, text: "" }]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [edited, setEdited] = useState<Record<string, unknown>>({});
  const [stale, setStale] = useState(false);
  const [details, setDetails] = useState(false);
  const [fill, setFill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const isDose = target.place === "posologies";
  const ready = parts.every((p) => p.text.trim() && p.page > 0);

  const verify = useCallback(async (t: Target = target, ps: Part[] = parts) => {
    if (!ps.every((p) => p.text.trim() && p.page > 0)) return setError("Collez la citation et indiquez sa page");
    setBusy(true);
    setError(null);
    try {
      const full = t.place === "node" ? { ...t, node: t.node ?? nodes.length, node_label: t.node_label || (t.node != null ? nodes[t.node] : "") || "Conduite" } : t;
      const p = await api<Proposal>(`/fichegen/drafts/${draftId}/propose`, { method: "POST", body: JSON.stringify({ target: full, parts: ps, fill }) });
      // what the reviewer already typed wins over the pre-fill
      const typed = Object.fromEntries(Object.entries(edited).filter(([, v]) => v !== "" && v != null));
      setProposal({ ...p, line: { ...p.line, ...typed }, target: p.placement ? { section: p.placement.section, place: "elements" } : full });
      if (p.placement) setTarget({ section: p.placement.section, place: "elements" });
      setStale(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draftId, target, parts, nodes, fill, edited]);

  // opened with a passage: checked at once (after this render); opened empty: the cursor in the quote, to paste
  useEffect(() => {
    if (!initialParts.length) return void (first.current as HTMLTextAreaElement | null)?.focus();
    const t = setTimeout(() => void verify(initial, initialParts), 0);
    return () => clearTimeout(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (proposal && !stale) first.current?.focus();
  }, [proposal?.line.source.quote]);  // eslint-disable-line react-hooks/exhaustive-deps

  const line = proposal?.line;
  const empty = line ? (isDose ? ["drug_dci", "dose", "route", "frequency_or_duration"] : ["text"]).filter((k) => !String(line[k] ?? "").trim()) : [];
  const blockedBy = !proposal ? null : stale ? "citation modifiée : revérifiez" : proposal.quote_status === "failed" ? "citation introuvable sur cette page"
    : empty.length ? `à remplir : ${empty.map((k) => FIELD_LABEL[k]).join(", ")}` : proposal.problems.length ? `non conforme : ${proposal.problems[0]}` : null;

  const accept = useCallback(async () => {
    if (!proposal || stale) return verify();
    if (blockedBy) return;
    setBusy(true);
    try {
      await onAccept(target, proposal.line);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [proposal, stale, blockedBy, onAccept, target, verify]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); void accept(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
  };
  const set = (patch: Record<string, unknown>) => {
    setEdited((x) => ({ ...x, ...patch }));
    if (proposal) setProposal({ ...proposal, line: { ...proposal.line, ...patch } });
  };
  const setPart = (i: number, patch: Partial<Part>) => { setParts((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p))); setStale(!!proposal); };
  const field = (label: string, k: string, ref?: boolean) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <input ref={ref ? (el) => { first.current = el; } : undefined} className={`${inputCls} h-9`} value={String(line?.[k] ?? "")}
        onChange={(e) => set({ [k]: e.target.value || null })} />
    </label>
  );

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-surface p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">Nouvelle ligne · {targetLabel(target)}</span>
        {target.place === "node" && (
          <span className="flex items-center gap-1.5 text-xs">
            <select className={`${inputCls} h-8 text-xs`} value={target.node ?? -1} onChange={(e) => { const n = Number(e.target.value); setTarget({ ...target, node: n < 0 ? undefined : n, node_label: n < 0 ? "" : nodes[n] }); }}>
              {nodes.map((n, i) => <option key={i} value={i}>{n}</option>)}
              <option value={-1}>Nouveau nœud…</option>
            </select>
            {target.node == null && <input className={`${inputCls} h-8 w-48 text-xs`} placeholder="Libellé du nœud" value={target.node_label ?? ""} onChange={(e) => setTarget({ ...target, node_label: e.target.value })} />}
          </span>
        )}
        <label className="ms-auto flex items-center gap-1.5 text-[11px] text-muted" title="Haiku remplit les champs (≈ 0,0003 $ la ligne)">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Pré-remplir (IA)
        </label>
      </div>

      {/* the quote: selected, clicked or pasted */}
      <div className="flex flex-col gap-2">
        {parts.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <label className="flex w-20 shrink-0 flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Page</span>
              <input inputMode="numeric" className={`${inputCls} h-9 tabular-nums`} value={p.page || ""} placeholder="2156"
                onChange={(e) => setPart(i, { page: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                Citation exacte{parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}
                {p.page > 0 && p.text && <button type="button" className="normal-case tracking-normal text-accentink hover:underline" onClick={() => onShow(p)}>voir dans le PDF</button>}
                {proposal?.part_status[i] === "failed" && <span className="normal-case tracking-normal text-flag">introuvable</span>}
              </span>
              <textarea ref={i === 0 && !initialParts.length ? (el) => { first.current = el; } : undefined} rows={Math.min(5, Math.max(2, Math.ceil(p.text.length / 90)))}
                placeholder="Collez ici le passage du guide, mot pour mot" className={`${inputCls} h-auto resize-y bg-cautionbg/40 py-2 text-[13px] leading-snug`}
                value={p.text} onChange={(e) => setPart(i, { text: e.target.value })} />
            </label>
            {parts.length > 1 && <button type="button" className="mt-6 text-muted hover:text-flag" onClick={() => { setParts(parts.filter((_, k) => k !== i)); setStale(!!proposal); }}>✕</button>}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="text-accentink hover:underline" onClick={() => { setParts([...parts, selection ?? { page: parts[parts.length - 1].page, text: "" }]); setStale(!!proposal); }}>
            + {selection ? "ajouter la sélection du PDF" : "autre passage"} à cette ligne</button>
          {(!proposal || stale) && (
            <button type="button" disabled={busy || !ready} onClick={() => void verify()}
              className="ms-auto inline-flex h-8 items-center gap-2 rounded-button border border-edge/15 bg-surface px-3 font-medium text-ink hover:bg-panel disabled:opacity-50">
              {busy ? <Spinner className="size-3" /> : null} Vérifier la citation <span className="font-mono text-[10px] text-muted">Ctrl ↵</span>
            </button>
          )}
        </div>
      </div>

      {proposal && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
            <span className={proposal.quote_status === "failed" ? "font-medium text-flag" : "font-medium text-accentink"}>
              {proposal.quote_status === "failed" ? "✕ Citation introuvable sur cette page" : "✓ Citation vérifiée dans le PDF"}</span>
            {Boolean(line?.grade) && <span className="text-soft">{String(line?.grade)}</span>}
            {proposal.nomenclature && (
              <span className={proposal.nomenclature.registered ? "text-accentink" : "text-caution"}>
                {proposal.nomenclature.brands ? `Nomenclature : ${proposal.nomenclature.registered}/${proposal.nomenclature.brands} enregistrée(s)` : "Absent de la nomenclature"}</span>
            )}
            {proposal.duplicate && <span className="text-caution">Déjà dans la fiche ? ({proposal.duplicate.section})</span>}
            {proposal.placement && <span className="text-caution">Placée en {targetLabel(target)} ({proposal.placement.why})</span>}
          </div>

          {isDose ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {field("DCI", "drug_dci", true)}{field("Dose", "dose")}{field("Voie", "route")}{field("Fréquence / durée", "frequency_or_duration")}
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Ligne de la fiche (français)</span>
              <textarea ref={(el) => { if (proposal) first.current = el; }} rows={2} placeholder="Ce que dit la citation, en français, et rien de plus"
                className={`${inputCls} h-auto resize-y py-2 text-sm leading-snug`} value={String(line?.text ?? "")} onChange={(e) => set({ text: e.target.value })} />
            </label>
          )}

          {details && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {isDose ? <>{field("Dose max", "dose_max")}{field("Administration", "administration")}{field("Condition", "condition")}</> : (
                <>
                  {field("Condition", "condition")}{field("Grade", "grade")}
                  <label className="flex flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-muted">Type</span>
                    <select className={`${inputCls} h-9`} value={String(line?.type)} onChange={(e) => set({ type: e.target.value })}>
                      {["action", "conditional", "info", "row"].map((t) => <option key={t}>{t}</option>)}</select></label>
                  <label className="flex flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-muted">Risque</span>
                    <select className={`${inputCls} h-9`} value={String(line?.risk)} onChange={(e) => set({ risk: e.target.value })}>
                      {["high", "medium", "low"].map((t) => <option key={t}>{t}</option>)}</select></label>
                </>
              )}
              <label className="col-span-2 flex flex-col gap-1 lg:col-span-4">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Manquant (une ligne par élément que la citation ne donne pas)</span>
                <textarea rows={1} className={`${inputCls} h-auto resize-y py-1.5`} value={((line?.missing as string[]) ?? []).join("\n")}
                  onChange={(e) => set({ missing: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
              </label>
            </div>
          )}
          {!isDose && target.section !== "8_ne_pas_faire" && DONOT.test(String(line?.text ?? "")) && (
            <p className="text-xs text-caution">Règle 4 : une consigne « ne pas faire » va dans Ne pas faire.{" "}
              <button type="button" className="font-medium underline" onClick={() => setTarget({ section: "8_ne_pas_faire", place: "elements" })}>Déplacer</button></p>
          )}
        </>
      )}

      {error && <p className="text-xs text-flag">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || (!!proposal && !stale && !!blockedBy) || !ready} onClick={() => void accept()}
          className="inline-flex h-9 items-center gap-2 rounded-button bg-btn px-4 text-sm font-medium text-btnink shadow-control hover:brightness-95 disabled:opacity-50">
          {busy ? <Spinner className="size-3" /> : null}{proposal && !stale ? "Ajouter à la fiche" : "Vérifier"} <span className="font-mono text-[10px] opacity-70">Ctrl ↵</span>
        </button>
        {proposal && <button type="button" className="h-9 rounded-button px-3 text-sm text-soft hover:bg-panel" onClick={() => setDetails((x) => !x)}>{details ? "Moins de champs" : "Plus de champs"}</button>}
        <button type="button" className="h-9 rounded-button px-3 text-sm text-soft hover:bg-panel" onClick={onCancel}>Annuler <span className="font-mono text-[10px] opacity-60">Échap</span></button>
        {proposal && !stale && blockedBy && <span className="text-xs text-flag">{blockedBy}</span>}
      </div>
    </div>
  );
}
