"use client";

import type { SourceRef } from "@medguides/schema";
import { createContext, useContext, useState, type ReactNode } from "react";

import { inputCls } from "@/components/ui";

/** What the source pane shows: a line's page, the source's own words, from which source. */
export type Shown = { source: SourceRef | null; label: string };
export const ShowCtx = createContext<(s: Shown) => void>(() => {});
/** Findings of the draft by element id (live validation): a failure blocks publishing, the rest is to check. */
export type Note = { failure: boolean; message: string };
export const FindingsCtx = createContext<Map<string, Note[]>>(new Map());

export const area =
  "w-full rounded-lg border border-edge/15 bg-input px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export const Label = ({ children }: { children: ReactNode }) => <span className="text-xs font-medium text-muted">{children}</span>;

export function Text({ label, value, onChange, className = "", placeholder, mono }: {
  label?: string; value: string | null | undefined; onChange: (v: string) => void; className?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      {label && <Label>{label}</Label>}
      <input className={`${inputCls} w-full ${mono ? "font-mono" : ""}`} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Area({ label, value, onChange, rows = 2, required, autoFocus }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void; rows?: number; required?: boolean; autoFocus?: boolean;
}) {
  const empty = required && !(value ?? "").trim();
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <Label>{label}{empty && <span className="ml-2 text-flag">obligatoire</span>}</Label>
      <textarea rows={rows} autoFocus={autoFocus} className={`${area} ${empty ? "border-flag" : ""}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string; value: T | null | undefined; options: readonly (readonly [T | "", string])[]; onChange: (v: T | null) => void; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <Label>{label}</Label>
      <select className={inputCls} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as T | null)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

/** A comma-separated list of short strings (missing fields, refs, synonyms). */
export const ListText = ({ label, value, onChange, className }: { label: string; value: string[]; onChange: (v: string[]) => void; className?: string }) => (
  <Text label={label} className={className} value={value.join(", ")} onChange={(v) => onChange(v.split(",").map((x) => x.trim()).filter(Boolean))} />
);

/** Where a line comes from, as the review showed it: its page and the source's own words. */
export const Cite = ({ source, origin, reviewer }: { source: SourceRef | null; origin?: string; reviewer?: string | null }) =>
  source ? (
    <p className="mt-1 border-l-2 border-edge/20 pl-2 text-xs text-muted">
      p. {source.page}{source.page_end ? `-${source.page_end}` : ""} · « {source.quote.length > 200 ? `${source.quote.slice(0, 200)}…` : source.quote} »
    </p>
  ) : origin === "local_adaptation" ? (
    <p className="mt-1 border-l-2 border-caution/40 pl-2 text-xs text-caution">Adaptation locale · {reviewer || "relecteur manquant"}</p>
  ) : null;

/** The findings of one element, under it: red blocks publishing, amber is to check. */
export function ItemFindings({ id }: { id: string }) {
  const all = useContext(FindingsCtx).get(id) ?? [];
  if (!all.length) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {all.map((f, i) => (
        <li key={i} className={`text-xs font-medium ${f.failure ? "text-flag" : "text-caution"}`}>
          {f.failure ? "✕" : "⚠"} {f.message}
        </li>
      ))}
    </ul>
  );
}

/** One thing of the fiche, read first as the app will say it. Focus shows its source; "Modifier"
 * (or a double click, or Enter) opens its fields, one item at a time. A new, empty item opens on its fields. */
export function Item({ shown, blank, read, form }: { shown?: Shown | null; blank?: boolean; read: ReactNode; form: ReactNode }) {
  const [editing, setEditing] = useState(!!blank);
  const show = useContext(ShowCtx);
  const see = () => (shown ? show(shown) : undefined);
  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-2.5 shadow-control" onFocusCapture={see}>
        {form}
        <button type="button" className="self-end rounded px-2 py-1 text-xs font-medium text-accentink hover:bg-tint" onClick={() => setEditing(false)}>
          Terminer
        </button>
      </div>
    );
  }
  return (
    <div tabIndex={0} onFocus={see} onClick={see} onDoubleClick={() => setEditing(true)} onKeyDown={(e) => (e.key === "Enter" && e.target === e.currentTarget ? setEditing(true) : undefined)}
      className="group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 outline-none hover:bg-panel focus:bg-tint/60 focus-within:bg-tint/60">
      <div className="min-w-0 flex-1">{read}</div>
      <button type="button" className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-accentink opacity-0 hover:bg-tint focus:opacity-100 group-hover:opacity-100 group-focus:opacity-100" onClick={() => setEditing(true)}>
        Modifier
      </button>
    </div>
  );
}

/** A list of anything: each item drawn by `render`, with quiet tools to move or remove it, and the link that adds one. */
export function List<T>({ items, onChange, blank, add, render }: { items: T[]; onChange: (v: T[]) => void; blank: () => T; add: string; render: (item: T, set: (v: T) => void, i: number) => ReactNode }) {
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
          <div className="min-w-0 flex-1">{render(item, (v) => set(i, v), i)}</div>
          <div className="flex shrink-0 pt-1.5 opacity-30 group-hover/row:opacity-100 focus-within:opacity-100">
            <button type="button" className={tool} disabled={i === 0} title="Monter" onClick={() => move(i, -1)}>↑</button>
            <button type="button" className={tool} disabled={i === items.length - 1} title="Descendre" onClick={() => move(i, 1)}>↓</button>
            <button type="button" className={`${tool} hover:text-flag`} title="Supprimer" onClick={() => onChange(items.filter((_, k) => k !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="mt-1 self-start rounded px-2 py-1 text-xs font-medium text-accentink hover:bg-tint" onClick={() => onChange([...items, blank()])}>
        + {add}
      </button>
    </div>
  );
}

/** A named group of lines inside a section. */
export const Block = ({ title, hint, aside, children }: { title: string; hint?: string; aside?: ReactNode; children: ReactNode }) => (
  <div>
    <div className="flex items-center gap-2">
      <h4 className="flex-1 text-xs font-semibold uppercase tracking-wide text-soft">{title}</h4>
      {aside}
    </div>
    {hint && <p className="text-xs text-muted">{hint}</p>}
    <div className="mt-1">{children}</div>
  </div>
);
