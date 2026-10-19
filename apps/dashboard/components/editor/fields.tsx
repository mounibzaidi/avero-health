"use client";

import type { Evidence, Issue } from "@medguides/schema";
import { createContext, useContext, useState, type ReactNode } from "react";

import { inputCls } from "@/components/ui";
import { TO_COMPLETE } from "@/lib/labels";

/** Validator issues of the draft, by line id (null = the fiche as a whole). */
export const IssuesCtx = createContext<Map<string | null, Issue[]>>(new Map());
/** Show an evidence in the PDF beside the fiche. */
export type Shown = { evidence: Evidence; label: string };
export const ShowCtx = createContext<(s: Shown) => void>(() => {});

/** Each block checked against the PDF: whether it is, toggling it, and its quotes' check (found / not found / not yet). */
export type Review = { verified: (line: Reviewed) => boolean; toggle: (line: Reviewed) => void; quote: (id: string) => "found" | "missing" | "unchecked" };
export type Reviewed = { id: string; evidence: Evidence[] };
export const ReviewCtx = createContext<Review | null>(null);

export const area =
  "w-full rounded-lg border border-edge/15 bg-input px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export const Label = ({ children }: { children: ReactNode }) => <span className="text-xs font-medium text-muted">{children}</span>;

export function Text({ label, value, onChange, className = "", mono, type = "text" }: {
  label?: string; value: string | number | null | undefined; onChange: (v: string) => void; className?: string; mono?: boolean; type?: "text" | "number" | "date";
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      {label && <Label>{label}</Label>}
      <input type={type} className={`${inputCls} w-full ${mono ? "font-mono" : ""}`} value={value ?? ""} placeholder={TO_COMPLETE} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Area({ label, value, onChange, rows = 2, className = "" }: { label: string; value: string | null | undefined; onChange: (v: string) => void; rows?: number; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-1 flex-col gap-1 ${className}`}>
      <Label>{label}</Label>
      <textarea rows={rows} className={area} value={value ?? ""} placeholder={TO_COMPLETE} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string; value: T | null | undefined; options: Record<T, string>; onChange: (v: T | null) => void; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <Label>{label}</Label>
      <select className={inputCls} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as T | null)}>
        <option value="">{TO_COMPLETE}</option>
        {(Object.entries(options) as [T, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** A list of short strings, one per line. */
export function Lines({ label, value, onChange, rows = 2 }: { label: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <Label>{label} (one per line)</Label>
      <textarea rows={rows} className={area} value={text} placeholder={TO_COMPLETE}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)); }} />
    </label>
  );
}

/** A comma-separated list of ids (refs, motifs). */
export const Ids = ({ label, value, onChange, className }: { label: string; value: string[]; onChange: (v: string[]) => void; className?: string }) => {
  const [text, setText] = useState(value.join(", "));
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <Label>{label}</Label>
      <input className={`${inputCls} w-full`} value={text} placeholder="none"
        onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean)); }} />
    </label>
  );
};

/** The issues of one line, under it: they block publishing. */
export function LineIssues({ id }: { id: string | null }) {
  const all = useContext(IssuesCtx).get(id) ?? [];
  if (!all.length) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {all.map((f, i) => <li key={i} className="text-xs font-medium text-flag">✕ {f.message}</li>)}
    </ul>
  );
}

/** A list of anything: each entry drawn by `render`, with tools to move or remove it, and the link that adds one. */
export function List<T>({ items, onChange, blank, add, render }: { items: T[]; onChange: (v: T[]) => void; blank: () => T; add: string; render: (item: T, set: (v: T) => void, i: number, fresh: boolean) => ReactNode }) {
  const [added, setAdded] = useState<number | null>(null);
  const set = (i: number, v: T) => onChange(items.map((x, k) => (k === i ? v : x)));
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const tool = "grid size-6 place-items-center rounded text-xs text-muted hover:bg-panel hover:text-ink disabled:opacity-20";
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <div key={i} className="group/row flex items-start gap-1 border-b border-line/70 py-0.5 last:border-0">
          <div className="min-w-0 flex-1">{render(item, (v) => set(i, v), i, added === i)}</div>
          <div className="flex shrink-0 pt-1.5 opacity-30 focus-within:opacity-100 group-hover/row:opacity-100">
            <button type="button" className={tool} disabled={i === 0} title="Move up" onClick={() => move(i, -1)}>↑</button>
            <button type="button" className={tool} disabled={i === items.length - 1} title="Move down" onClick={() => move(i, 1)}>↓</button>
            <button type="button" className={`${tool} hover:text-flag`} title="Delete" onClick={() => onChange(items.filter((_, k) => k !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="mt-1 self-start rounded px-2 py-1 text-xs font-medium text-accentink hover:bg-tint" onClick={() => { setAdded(items.length); onChange([...items, blank()]); }}>
        + {add}
      </button>
    </div>
  );
}
