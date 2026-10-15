import { BLOCKS, DISPLAY_MAP, LOCATIONS, type BlockId, type DisplayEntry, type Element, type Fiche, type Posologie, type SectionState, type SourceRef } from "@medguides/schema";

/**
 * A stored fiche (numbered schema) turned into the v4 screen blocks, through the display map
 * (packages/schema display.ts = FORMAT_MAPPING §2). No screen code here.
 */

/** Anything a tap can show the source of. */
export type Cited = { source: SourceRef | null; translated?: boolean; origin?: string; reviewer?: string | null };

export type DoseView = {
  pos: Posologie;
  /** Red on the closed card: attached risk-high lines of 7.contre_indications and 8 (dose_max is shown with them). */
  red: Element[];
  details: Element[];
  variants: { group: string; lines: Element[] }[];
  overdose: { signes: Element[]; conduite: Element[] };
};

export type EntryView = {
  entry: DisplayEntry;
  state: SectionState;
  lines: Element[];
  nodes: { node: string; branches: Element[] }[];
  doses: DoseView[];
};

export type BlockView = {
  id: BlockId;
  /** open: visible sub-blocks shown, collapsed ones as one row inside. collapsed: the whole block is one step card. */
  mode: "open" | "collapsed";
  /** No content anywhere in the block, and the source does not treat it. */
  notCovered: boolean;
  open: EntryView[];
  folded: EntryView[];
  count: number;
};

const size = (e: EntryView) => e.lines.length + e.doses.length + e.nodes.reduce((n, x) => n + x.branches.length, 0);

export function blocks(f: Fiche): BlockView[] {
  const S = f.sections;
  const template = f.meta.template;
  const all = LOCATIONS.flatMap((l) => l.get(S).map((el) => ({ el, path: l.path })));
  const attached = all.filter((x) => x.el.attached_to.length > 0);

  const doseViews: DoseView[] = S["7_traitement"].posologies.map((pos) => {
    const mine = attached.filter((x) => x.el.attached_to.includes(pos.id));
    const red = mine.filter((x) => x.el.risk === "high" && (x.path === "7_traitement.contre_indications" || x.path === "8_ne_pas_faire")).map((x) => x.el);
    const groups = new Map<string, Element[]>();
    for (const x of mine) if (x.el.variant_group) groups.set(x.el.variant_group, [...(groups.get(x.el.variant_group) ?? []), x.el]);
    const rest = mine.filter((x) => !red.includes(x.el) && !x.el.variant_group);
    return {
      pos,
      red,
      variants: [...groups].map(([group, lines]) => ({ group, lines })),
      overdose: { signes: rest.filter((x) => x.path === "10_surveillance").map((x) => x.el), conduite: rest.filter((x) => x.path === "5_conduite.nodes").map((x) => x.el) },
      details: rest.filter((x) => x.path !== "10_surveillance" && x.path !== "5_conduite.nodes").map((x) => x.el),
    };
  });

  const free = (els: Element[]) => els.filter((e) => e.attached_to.length === 0);
  const stateOf = (d: DisplayEntry): SectionState => {
    if (d.path === "7_traitement.posologies") return S["7_traitement"].state;
    const loc = LOCATIONS.find((l) => l.path === d.path)!;
    return loc.block?.(S)?.state ?? S[loc.section].state;
  };
  const view = (d: DisplayEntry): EntryView => {
    const base = { entry: d, state: stateOf(d), lines: [] as Element[], nodes: [] as EntryView["nodes"], doses: [] as DoseView[] };
    if (d.path === "7_traitement.posologies") return { ...base, doses: doseViews };
    if (d.path === "5_conduite.nodes")
      return { ...base, nodes: S["5_conduite"].nodes.map((n) => ({ node: n.node, branches: free(n.branches) })).filter((n) => n.branches.length) };
    let lines = free(LOCATIONS.find((l) => l.path === d.path)!.get(S));
    if (d.only === "phase_null") lines = lines.filter((e) => e.phase == null);
    if (d.only === "phase_set") lines = lines.filter((e) => e.phase != null);
    return { ...base, lines };
  };

  const out: BlockView[] = [];
  for (const id of BLOCKS) {
    const entries = DISPLAY_MAP.filter((d) => d.block === id && d[template] !== null)
      .map(view)
      .filter((e) => e.state !== "sans_objet");
    if (!entries.length) continue;
    const withContent = entries.filter((e) => size(e) > 0);
    const visible = (e: EntryView) => e.entry[template] === "visible";
    const notCovered = withContent.length === 0;
    if (notCovered && !entries.some((e) => e.state === "non_traité")) continue;
    const anyVisible = withContent.some(visible) || (notCovered && entries.some(visible));
    out.push({
      id,
      mode: anyVisible ? "open" : "collapsed",
      notCovered,
      open: anyVisible ? withContent.filter(visible) : withContent,
      folded: anyVisible ? withContent.filter((e) => !visible(e)) : [],
      count: withContent.reduce((n, e) => n + size(e), 0),
    });
  }
  return out;
}

/** Sub-block of a block, when present. */
export const sub = (b: BlockView, s: string) => [...b.open, ...b.folded].find((e) => e.entry.sub === s);
