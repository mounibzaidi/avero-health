"use client";

import { Spinner } from "@/components/ui";

/** The steps of fiche generation (services/api/app/fichegen/pipeline.py), in order, by the draft's stage. */
export const STEPS = [
  { stage: "ingesting", label: "Lecture du PDF", hint: "pdftotext, pages imprimées" },
  { stage: "routing", label: "Répartition", hint: "pages utiles à chaque section" },
  { stage: "parsing", label: "Tableaux et figures", hint: "posologies, figures en image" },
  { stage: "generating", label: "Rédaction", hint: "une section à la fois" },
  { stage: "checking", label: "Citations", hint: "chaque ligne retrouvée dans le PDF" },
  { stage: "coverage", label: "Couverture", hint: "recommandations et posologies" },
  { stage: "done", label: "Brouillon prêt", hint: "à relire" },
] as const;

export const RUNNING = new Set(["uploaded", "ingesting", "ready", "routing", "parsing", "generating", "checking", "coverage"]);

const ORDER: Record<string, number> = { uploaded: 0, ingesting: 0, needs_offset: 1, ready: 1, routing: 1, parsing: 2, generating: 3, checking: 4, coverage: 5, done: 6 };

export function stepIndex(stage: string): number {
  return ORDER[stage] ?? 0;
}

/** A thin bar for a draft in a list: how far its generation is. */
export function ProgressBar({ stage }: { stage: string }) {
  const pct = stage === "done" ? 100 : stage === "error" ? 100 : Math.round(((stepIndex(stage) + 0.5) / STEPS.length) * 100);
  const tone = stage === "error" ? "bg-flag" : stage === "done" ? "bg-accent" : stage === "needs_offset" ? "bg-caution" : "bg-accent/70";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
      <div className={`h-full rounded-full ${tone} transition-[width] duration-700 ${RUNNING.has(stage) ? "animate-pulse" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The full step list while a draft is generating. */
export function Stepper({ stage, detail }: { stage: string; detail: string | null }) {
  const at = stepIndex(stage);
  return (
    <ol className="flex flex-col">
      {STEPS.map((s, i) => {
        const state = stage === "done" || i < at ? "done" : i === at ? (stage === "error" ? "error" : "current") : "todo";
        return (
          <li key={s.stage} className="relative flex gap-3 pb-5 last:pb-0">
            {i < STEPS.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px ${state === "done" ? "bg-accent/50" : "bg-line"}`} />}
            <span className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              state === "done" ? "bg-accent text-white" : state === "current" ? "bg-tint text-accentink ring-2 ring-accent/40" : state === "error" ? "bg-flagbg text-flag ring-2 ring-flag/40" : "bg-panel text-muted"}`}>
              {state === "done" ? "✓" : state === "current" ? <Spinner className="size-3" /> : state === "error" ? "!" : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm font-medium ${state === "todo" ? "text-muted" : "text-ink"}`}>{s.label}</p>
              <p className="text-xs text-muted">{state === "current" && detail ? detail : s.hint}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
