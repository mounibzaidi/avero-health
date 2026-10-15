"use client";

import type { Issue, QuoteResult, Rule, Source } from "@medguides/schema";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

import type { Shown } from "./fields";

const RULE_LABEL: Record<Rule, string> = {
  structure: "Format", required: "Champ à compléter", ids: "Identifiants", evidence: "Preuves", basis: "Adaptation locale", quote: "Citations",
  numbers: "Nombres", pathway: "Arbre de décision", refs: "Références", missing: "Champs manquants", availability: "Disponibilité", approval: "Validation clinique",
};

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Chargement…</p> });

const goTo = (id: string | null) => {
  const el = id ? document.getElementById(`line-${id}`) : document.getElementById("section-review");
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/** Issues of both validator levels, grouped by rule; a click goes to the line. */
function Issues({ structure, gate }: { structure: Issue[]; gate: Issue[] }) {
  const all = [...structure, ...gate];
  if (!all.length) return <p className="rounded-lg bg-tint px-3 py-2 text-sm font-medium text-accentink">Aucun problème : la fiche peut être publiée.</p>;
  const groups = new Map<Rule, Issue[]>();
  for (const i of all) groups.set(i.rule, [...(groups.get(i.rule) ?? []), i]);
  return (
    <div className="flex flex-col gap-3">
      {structure.length > 0 && <p className="text-xs font-medium text-flag">Format invalide : corrigez-le d&apos;abord (la publication en dépend).</p>}
      {[...groups].map(([rule, list]) => (
        <div key={rule}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-soft">{RULE_LABEL[rule]} ({list.length})</h4>
          <ul className="flex flex-col gap-0.5">
            {list.map((i, k) => (
              <li key={k}>
                <button type="button" className="w-full rounded px-1.5 py-1 text-left text-sm hover:bg-panel" onClick={() => goTo(i.item_id)}>
                  <span className="me-1.5 font-mono text-xs text-muted">{i.item_id ?? "fiche"}</span>
                  <span className="text-flag">{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Quotes({ quotes, total, checking, onCheck, error }: { quotes: Record<string, QuoteResult>; total: number; checking: boolean; onCheck: () => void; error: string | null }) {
  const entries = Object.entries(quotes);
  const found = entries.filter(([, r]) => r.found).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h4 className="flex-1 text-xs font-semibold uppercase tracking-wide text-soft">Vérification des citations</h4>
        <Button className="h-7 px-2 text-xs" disabled={checking || !total} onClick={onCheck}>{checking ? <Spinner /> : "Vérifier"}</Button>
      </div>
      {error ? <p className="text-xs text-flag">{error}</p> : null}
      <p className="text-sm text-soft">{total ? `${found} / ${total} citation(s) trouvée(s) sur leur page du PDF.` : "Aucune citation à vérifier."}</p>
      <ul className="flex flex-col gap-0.5">
        {entries.map(([key, r]) => (
          <li key={key}>
            <button type="button" className="w-full rounded px-1.5 py-0.5 text-left text-xs hover:bg-panel" onClick={() => goTo(key.split("#")[0])}>
              <span className="me-1.5 font-mono text-muted">{key}</span>
              {r.found ? <span className="text-accent">trouvée</span> : <span className="text-flag">non trouvée{r.message ? ` : ${r.message}` : ""}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The cited page of the source's stored PDF, with the quote marked. */
function PdfPane({ shown, sources, pdfs }: { shown: Shown; sources: Source[]; pdfs: Record<string, string> }) {
  const e = shown.evidence;
  const src = sources.find((s) => s.id === e.source_id);
  const path = pdfs[e.source_id];
  const [url, setUrl] = useState<{ path: string; url: string } | null>(null);
  const [page, setPage] = useState<{ key: string; n: number } | null>(null);
  useEffect(() => {
    if (!path || url?.path === path) return;
    api<{ url: string }>(`/crawl/file?path=${encodeURIComponent(path)}`).then((r) => setUrl({ path, url: r.url }), () => {});
  }, [path, url]);
  const cited = Math.max(1, (e.page ?? 1) + (src?.page_offset ?? 0));
  const key = `${e.source_id}|${e.page}|${e.quote}`;
  const shownPage = page?.key === key ? page.n : cited;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line p-3 text-sm">
        <p className="text-ink">{shown.label || "[à compléter]"}</p>
        <p className="mt-1 text-xs font-semibold text-accentink">{src?.organisation ?? e.source_id} · page {e.page} (page {cited} du PDF)</p>
        <blockquote className="mt-1 border-s-2 border-accent ps-2 text-xs text-soft">{e.quote}</blockquote>
      </div>
      <div className="min-h-0 flex-1">
        {path && url?.path === path ? (
          <PdfViewer url={url.url} page={shownPage} quote={shownPage === cited ? e.quote : ""} onPageChange={(n) => setPage({ key, n })} />
        ) : (
          <p className="p-3 text-sm text-muted">{path ? "Chargement du PDF…" : "Pas de PDF pour cette source : choisissez-le dans Sources."}</p>
        )}
      </div>
    </div>
  );
}

export function SidePanel(props: {
  structure: Issue[]; gate: Issue[]; quotes: Record<string, QuoteResult>; quoteTotal: number; checking: boolean; checkError: string | null; onCheck: () => void;
  shown: Shown | null; onCloseShown: () => void; sources: Source[]; pdfs: Record<string, string>;
}) {
  const [tab, setTab] = useState<"checks" | "pdf">("checks");
  const [lastShown, setLastShown] = useState<Shown | null>(null);
  if (props.shown !== lastShown) {
    setLastShown(props.shown);
    if (props.shown) setTab("pdf");
  }
  const count = props.structure.length + props.gate.length;
  const tabCls = (on: boolean) => `rounded-lg px-2.5 py-1 text-sm ${on ? "bg-tint font-medium text-accentink" : "text-soft hover:bg-panel"}`;
  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <button type="button" className={tabCls(tab === "checks")} onClick={() => setTab("checks")}>Contrôles{count ? ` (${count})` : ""}</button>
        <button type="button" className={tabCls(tab === "pdf")} disabled={!props.shown} onClick={() => setTab("pdf")}>PDF</button>
        {tab === "pdf" && props.shown && <button type="button" className="ms-auto text-xs text-muted hover:text-ink" onClick={() => { props.onCloseShown(); setTab("checks"); }}>Fermer</button>}
      </div>
      {tab === "pdf" && props.shown ? (
        <PdfPane shown={props.shown} sources={props.sources} pdfs={props.pdfs} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
          <Issues structure={props.structure} gate={props.gate} />
          <Quotes quotes={props.quotes} total={props.quoteTotal} checking={props.checking} onCheck={props.onCheck} error={props.checkError} />
        </div>
      )}
    </div>
  );
}
