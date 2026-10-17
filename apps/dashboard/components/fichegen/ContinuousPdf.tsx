"use client";

import "react-pdf/dist/Page/TextLayer.css";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { itemsCoveringQuote } from "@/lib/normalise";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A selection in the PDF: its text, its PDF page, and where it sits on screen (for the floating bar). */
export interface PdfSelection { pdfPage: number; text: string; rect: { x: number; y: number; bottom: number } }

/** One page: rendered only near the screen; the focused quote marked in yellow, the fiche's other quotes in green. */
const PdfPage = memo(function PdfPage({ n, width, ratio, near, quote, used, onMarked }: {
  n: number; width: number; ratio: number; near: boolean; quote: string; used: string[]; onMarked: (n: number) => void;
}) {
  const [marks, setMarks] = useState<{ key: string; idx: Set<number>; used: Set<number> }>({ key: "", idx: new Set(), used: new Set() });
  const key = `${quote}\u0002${used.join("\u0001")}`;
  const onText = useCallback(({ items }: { items: Array<{ str: string } | object> }) => {
    const strs = items.map((i) => ("str" in i ? i.str : ""));
    setMarks({ key, idx: new Set(quote ? itemsCoveringQuote(strs, quote) : []), used: new Set(used.flatMap((q) => itemsCoveringQuote(strs, q))) });
  }, [key, quote, used]);
  const fresh = marks.key === key;
  const render = useCallback(({ str, itemIndex }: { str: string; itemIndex: number }) =>
    fresh && marks.idx.has(itemIndex) ? `<mark>${escapeHtml(str)}</mark>` : fresh && marks.used.has(itemIndex) ? `<mark class="used">${escapeHtml(str)}</mark>` : escapeHtml(str),
  [fresh, marks]);
  return (
    <div data-page={n} className="pdf-page relative mx-auto mb-4 overflow-hidden rounded-md bg-white shadow-[0_1px_3px_rgba(0,0,0,.10),0_10px_30px_rgba(0,0,0,.06)]"
      style={{ width, height: Math.round(width * ratio) }}>
      {near ? (
        <Page key={key} pageNumber={n} width={width} renderAnnotationLayer={false} onGetTextSuccess={onText} customTextRenderer={render}
          onRenderTextLayerSuccess={() => quote && onMarked(n)} loading={<div className="h-full w-full bg-white" />} />
      ) : null}
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">{n}</span>
    </div>
  );
});

/**
 * The whole guideline in one scroll, every page at a readable width. Pages are drawn only near the screen. `focus`
 * scrolls to a page and marks its quote; `onPage` reports the page in view; `onSelect` the text the reviewer selects.
 */
export default function ContinuousPdf({ url, focus, usedOn, onPage, onSelect }: {
  url: string;
  focus: { pdfPage: number; quote: string; nonce: number } | null;
  usedOn: (pdfPage: number) => string[];
  onPage: (pdfPage: number) => void;
  onSelect: (s: PdfSelection | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [pages, setPages] = useState(0);
  const [ratio, setRatio] = useState(1.32);
  const [near, setNear] = useState<Set<number>>(new Set([1, 2]));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.min(1100, Math.floor(e.contentRect.width) - 40))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // which pages are near the screen (drawn), and which one is in view
  useEffect(() => {
    const el = box.current;
    if (!el || !pages) return;
    const io = new IntersectionObserver((entries) => {
      setNear((cur) => {
        const next = new Set(cur);
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) next.add(n);
          else next.delete(n);
        }
        return next;
      });
    }, { root: el, rootMargin: "1500px 0px" });
    el.querySelectorAll<HTMLElement>("[data-page]").forEach((p) => io.observe(p));
    const onScroll = () => {
      const top = el.scrollTop + el.clientHeight / 3;
      const hit = [...el.querySelectorAll<HTMLElement>("[data-page]")].find((p) => p.offsetTop + p.offsetHeight > top);
      if (hit) onPage(Number(hit.dataset.page));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, [pages, width, onPage]);

  // a line clicked: its page brought into view (then its mark, once the text layer is drawn)
  useEffect(() => {
    const el = box.current;
    const p = el?.querySelector<HTMLElement>(`[data-page="${focus?.pdfPage}"]`);
    if (el && p) el.scrollTo({ top: p.offsetTop - 12, behavior: "smooth" });
  }, [focus]);
  const onMarked = useCallback((n: number) => {
    if (n !== focus?.pdfPage) return;
    box.current?.querySelector(`[data-page="${n}"] .textLayer mark:not(.used)`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    const node = sel?.anchorNode;
    const pageEl = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-page]");
    if (!text || !sel || !pageEl || !box.current?.contains(pageEl)) return onSelect(null);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    onSelect({ pdfPage: Number(pageEl.dataset.page), text, rect: { x: r.left + r.width / 2, y: r.top, bottom: r.bottom } });
  };

  return (
    <div ref={box} className="h-full min-h-0 overflow-auto bg-panel px-5 py-5" onMouseUp={onMouseUp}>
      {error ? <p className="text-sm text-flag">{error}</p> : (
        <Document file={url} loading={<p className="text-sm text-muted">Chargement du PDF…</p>}
          onLoadError={(e) => setError(`Impossible d'ouvrir le PDF : ${e.message}`)}
          onLoadSuccess={async (pdf) => {
            setPages(pdf.numPages);
            const v = (await pdf.getPage(1)).getViewport({ scale: 1 });
            setRatio(v.height / v.width);
          }}>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <PdfPage key={n} n={n} width={width} ratio={ratio} near={near.has(n)} onMarked={onMarked}
              quote={focus?.pdfPage === n ? focus.quote : ""} used={near.has(n) ? usedOn(n) : []} />
          ))}
        </Document>
      )}
    </div>
  );
}
