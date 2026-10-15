"use client";

import "react-pdf/dist/Page/TextLayer.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { itemsCoveringQuote } from "@/lib/normalise";

// Must be set in the module that renders <Document>/<Page> (react-pdf README).
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type TextContent = { items: Array<{ str: string } | object> };
const EMPTY = new Set<number>();

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PdfViewerProps {
  url: string;
  page: number;
  quote: string;
  /** Other quotes to mark on this page, in a second colour: everything a protocol already takes from it. */
  used?: string[];
  onPageChange: (page: number) => void;
  /** Called once the page's text is read: whether the quote was found there. target = url|page|quote. */
  onHighlight?: (target: string, found: boolean) => void;
}

export default function PdfViewer({ url, page, quote, used, onPageChange, onHighlight }: PdfViewerProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [numPages, setNumPages] = useState<number | null>(null);
  const target = `${url}|${page}|${quote}`;
  const usedKey = (used ?? []).join("\u0001");
  const [marks, setMarks] = useState<{ target: string; idx: Set<number>; used: Set<number> }>({ target: "", idx: new Set(), used: new Set() });
  const fresh = marks.target === `${target}|${usedKey}`;
  const marked = fresh ? marks.idx : EMPTY;
  const alsoMarked = fresh ? marks.used : EMPTY;
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width) - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onText = useCallback(
    ({ items }: TextContent) => {
      const strs = items.map((i) => ("str" in i ? i.str : ""));
      const idx = itemsCoveringQuote(strs, quote);
      setMarks({ target: `${target}|${usedKey}`, idx: new Set(idx), used: new Set((used ?? []).flatMap((q) => itemsCoveringQuote(strs, q))) });
      onHighlight?.(target, idx.length > 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `used` is read through its key
    [quote, target, usedKey, onHighlight],
  );

  const renderText = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) =>
      marked.has(itemIndex) ? `<mark>${escapeHtml(str)}</mark>` : alsoMarked.has(itemIndex) ? `<mark class="used">${escapeHtml(str)}</mark>` : escapeHtml(str),
    [marked, alsoMarked],
  );

  const scrollToMark = useCallback(() => {
    const mark = box.current?.querySelector(".textLayer mark:not(.used)");
    mark?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const file = useMemo(() => ({ url }), [url]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-1.5 text-sm">
        <button className="rounded px-2 py-1 text-soft hover:bg-panel disabled:opacity-40" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Page précédente">
          ‹
        </button>
        <span className="tabular-nums text-soft">
          Page {page}
          {numPages ? ` / ${numPages}` : ""}
        </span>
        <button
          className="rounded px-2 py-1 text-soft hover:bg-panel disabled:opacity-40"
          disabled={!numPages || page >= numPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Page suivante"
        >
          ›
        </button>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-panel p-4">
        {loadError ? (
          <p className="text-sm text-flag">{loadError}</p>
        ) : (
          <Document
            file={file}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(e) => setLoadError(`Impossible d'ouvrir le PDF : ${e.message}`)}
            loading={<p className="text-sm text-muted">Chargement du PDF…</p>}
          >
            <div className="pdf-page mx-auto w-fit overflow-hidden rounded shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.06)]">
              <Page
                key={`${page}-${quote}-${usedKey.length}-${used?.length ?? 0}`}
                pageNumber={page}
                width={width}
                renderAnnotationLayer={false}
                onGetTextSuccess={onText}
                customTextRenderer={renderText}
                onRenderTextLayerSuccess={scrollToMark}
                loading={<div style={{ width, height: width * 1.41 }} className="bg-surface" />}
              />
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}
