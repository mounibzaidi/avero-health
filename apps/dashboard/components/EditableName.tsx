"use client";

import { useState } from "react";

/** A name shown as text; a click turns it into a field, Enter or leaving it saves, Escape cancels. `editing`/`onEditing`:
 * the field opened from outside (a Rename button). */
export function EditableName({ name, onSave, className = "", editing, onEditing }: {
  name: string; onSave: (name: string) => void | Promise<void>; className?: string; editing?: boolean; onEditing?: (on: boolean) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  // opened from outside, nothing typed yet: the field starts from the name
  const draft = typed ?? (editing ? name : null);
  const setDraft = (v: string | null) => { setTyped(v); onEditing?.(v !== null); };
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
