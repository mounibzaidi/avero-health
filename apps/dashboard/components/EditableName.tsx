"use client";

import { useState } from "react";

/** A name shown as text; a click turns it into a field, Enter or leaving it saves, Escape cancels. */
export function EditableName({ name, onSave, className = "" }: { name: string; onSave: (name: string) => void | Promise<void>; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" title="Click to rename" onClick={() => setDraft(name)}
        className={`min-w-0 truncate rounded px-1 -mx-1 text-left hover:bg-panel ${className}`}>{name}</button>
    );
  }
  const save = () => {
    const v = draft.trim();
    setDraft(null);
    if (v && v !== name) void onSave(v);
  };
  return (
    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setDraft(null); }}
      className={`min-w-0 rounded border border-line bg-surface px-1 outline-none focus:border-accent ${className}`} />
  );
}
