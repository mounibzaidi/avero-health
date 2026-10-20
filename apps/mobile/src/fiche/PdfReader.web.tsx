import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { t } from "@/strings/fr";

/**
 * A page of the guideline's PDF drawn with pdf.js, the quote marked on it. pdf.js (6.3.289, legacy build, the
 * dashboard's version) is served from public/pdfjs and loaded at run time: the bundler cannot take it in.
 */

type Item = { str?: string; transform: number[]; width: number };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number; transform: number[] };
  render: (o: object) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: Item[] }>;
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (o: { url: string }) => { promise: Promise<PdfDoc> };
  Util: { transform: (a: number[], b: number[]) => number[] };
};

let lib: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  // an import the bundler does not see, of the file served beside the app
  lib ??= (new Function("u", "return import(u)") as (u: string) => Promise<PdfJs>)("/pdfjs/pdf.min.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

// Same matching as the dashboard's quote check: case, accents, punctuation and spaces ignored.
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^\p{L}\p{N}]+/gu, "");

/** Where the quote sits in the page's text items: per item, the character range [start, end) it covers. */
function quoteRanges(items: string[], quote: string): Map<number, [number, number]> {
  const needle = norm(quote);
  const out = new Map<number, [number, number]>();
  if (!needle) return out;
  let hay = "";
  const owner: [number, number, number][] = [];
  items.forEach((str, idx) => {
    for (let k = 0; k < str.length; ) {
      const ch = String.fromCodePoint(str.codePointAt(k)!);
      const n = norm(ch);
      hay += n;
      for (let j = 0; j < n.length; j++) owner.push([idx, k, k + ch.length]);
      k += ch.length;
    }
  });
  const at = hay.indexOf(needle);
  if (at < 0) return out;
  for (let i = at; i < at + needle.length; i++) {
    const [idx, s, e] = owner[i];
    const r = out.get(idx);
    out.set(idx, r ? [Math.min(r[0], s), Math.max(r[1], e)] : [s, e]);
  }
  return out;
}

type Rect = { x: number; y: number; w: number; h: number };

export function PdfReader({ url, page, width, quote, onPages }: { url: string; page: number; width: number; quote: string; onPages: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [lib, setLib] = useState<PdfJs | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [marks, setMarks] = useState<Rect[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void pdfjs().then(async (m) => {
      const d = await m.getDocument({ url }).promise;
      if (!live) return;
      setLib(m);
      setDoc(d);
      onPages(d.numPages);
    }).catch(() => live && setError(true));
    return () => { live = false; };
  }, [url, onPages]);

  useEffect(() => {
    if (!doc || !lib || !canvas.current || width <= 0) return;
    let live = true;
    void (async () => {
      const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
      const viewport = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      const ctx = c.getContext("2d")!;
      await p.render({ canvas: c, canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
      const { items } = await p.getTextContent();
      const strs = items.map((x) => x.str ?? "");
      const rects: Rect[] = [];
      for (const [i, [s, e]] of quote ? quoteRanges(strs, quote) : []) {
        const it = items[i];
        const tx = lib.Util.transform(viewport.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]);
        const w = it.width * (viewport.width / p.getViewport({ scale: 1 }).width);
        const len = Math.max(1, strs[i].length);
        rects.push({ x: tx[4] + (w * s) / len, y: tx[5] - h, w: (w * (e - s)) / len, h: h * 1.15 });
      }
      if (!live) return;
      setSize({ w: viewport.width, h: viewport.height });
      setMarks(rects);
    })().catch(() => live && setError(true));
    return () => { live = false; };
  }, [doc, lib, page, width, quote]);

  if (error) return <Text className="p-5 text-[14px] text-soft">{t("r_error")}</Text>;
  return (
    <View style={{ width, alignSelf: "center" }}>
      {!size ? <Text className="p-5 text-[14px] text-muted">{t("r_loading")}</Text> : null}
      <div style={{ position: "relative", width: size?.w, height: size?.h, background: "white", boxShadow: "0 1px 3px rgba(0,0,0,.12)" }}>
        <canvas ref={canvas} style={{ width: size?.w, height: size?.h, display: "block" }} />
        {marks.map((r, i) => (
          <div key={i} style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, background: "rgba(255,213,79,.45)", borderRadius: 2 }} />
        ))}
      </div>
    </View>
  );
}
