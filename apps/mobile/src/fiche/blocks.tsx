import type { BlockId, Element, Fiche } from "@medguides/schema";
import { useState, type ReactNode } from "react";
import { Pressable, Share, Text, View } from "react-native";

import { t, type StringKey } from "@/strings/fr";
import {
  ArrowRightIcon, BookOpenIcon, CalendarCheckIcon, CaretDownIcon, CaretRightIcon, CheckIcon, ClipboardTextIcon, ClockIcon, ExportIcon,
  HospitalIcon, LightningIcon, PillIcon, ProhibitIcon, StethoscopeIcon, TableIcon, TargetIcon, UsersThreeIcon,
} from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, joinMeta } from "@/ui/ui";

import { Dose } from "./Dose";
import type { BlockView, EntryView } from "./model";
import { ActionButton, Card, Lines, NotCovered, Paper, RedBox, Rows, StepCard, StepNumber, Sub, useCap, type Open } from "./parts";

/** Block title (heading, jump chip, sidebar) and icon: the same on every fiche. */
export const BLOCK_LABEL: Record<BlockId, StringKey> = {
  decision: "p_sec_decision",
  essentiel: "p_sec_essentiel",
  reconnaitre: "p_sec_reconnaitre",
  etapes: "p_sec_etapes",
  conduite: "p_sec_conduite",
  bilans: "p_sec_bilans",
  traitement: "p_sec_traitement",
  a_eviter: "p_sec_a_eviter",
  orienter: "p_sec_orienter",
  suivi: "p_sec_suivi",
  champ: "p_sec_champ",
  definitions: "p_sec_definitions",
};
export const CHIP_LABEL: Partial<Record<BlockId, StringKey>> = { decision: "p_chip_decision" };

export const BLOCK_ICON: Record<BlockId, (p: { size: number; color: string }) => ReactNode> = {
  decision: (i) => <ArrowRightIcon {...i} weight="bold" />,
  essentiel: (i) => <ClockIcon {...i} weight="bold" />,
  reconnaitre: (i) => <TargetIcon {...i} weight="bold" />,
  etapes: (i) => <LightningIcon {...i} weight="fill" />,
  conduite: (i) => <TableIcon {...i} />,
  bilans: (i) => <StethoscopeIcon {...i} />,
  traitement: (i) => <PillIcon {...i} weight="bold" />,
  a_eviter: (i) => <ProhibitIcon {...i} weight="bold" />,
  orienter: (i) => <HospitalIcon {...i} />,
  suivi: (i) => <CalendarCheckIcon {...i} />,
  champ: (i) => <UsersThreeIcon {...i} />,
  definitions: (i) => <BookOpenIcon {...i} />,
};

const SUB_LABEL: Record<string, StringKey> = {
  symptomes: "p_rec_symptomes",
  formes_trompeuses: "p_rec_formes_trompeuses",
  criteres: "p_rec_criteres",
  differentiel: "p_rec_differentiel",
  gravite: "p_rec_gravite",
  examen_clinique: "p_exam",
  examens: "p_sec_bilans",
  surveillance: "p_surveillance",
  suivi: "p_sec_suivi",
  conseils_patient: "p_patient_advice",
  conduite: "p_sec_conduite",
};
const subLabel = (e: EntryView) => t(SUB_LABEL[e.entry.sub] ?? BLOCK_LABEL[e.entry.block]);

/** The steps, in order: touching one ticks it; a long press shows its source. */
function Checklist({ lines, open }: { lines: Element[]; open: Open }) {
  const c = useColors();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [shown, more] = useCap(lines);
  return (
    <Card>
      {shown.map((l, i) => {
        const on = !!done[l.id];
        return (
          <Pressable key={l.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityHint={t("p_long_press_source")}
            onPress={() => setDone((s) => ({ ...s, [l.id]: !on }))} onLongPress={() => open(l)}
            className={`min-h-[52px] flex-row items-center gap-3 py-3 active:opacity-70 ${i ? "border-t border-line" : ""}`}>
            <View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-tint">
              {on ? <CheckIcon size={15} color={c.accent} weight="bold" /> : <Text className="text-[13px] font-bold text-accentink">{i + 1}</Text>}
            </View>
            <Body className={`min-w-0 flex-1 text-[14.5px] leading-[20px] ${on ? "text-muted line-through" : "font-medium text-ink"}`}>{l.text}</Body>
          </Pressable>
        );
      })}
      {more}
    </Card>
  );
}

/** Decision pathway (5_conduite): one numbered step card per node, one open at a time, the first open. */
function StepCards({ nodes, open }: { nodes: EntryView["nodes"]; open: Open }) {
  const [shown, setShown] = useState<number | null>(0);
  return (
    <View className="gap-3">
      {nodes.map((n, i) => (
        <StepCard key={i} on={shown === i} onToggle={() => setShown(shown === i ? null : i)} badge={<StepNumber n={i + 1} on={shown === i} />} title={n.node} count={n.branches.length}>
          <Lines lines={n.branches} open={open} />
        </StepCard>
      ))}
    </View>
  );
}

/** The tests: the name, and the condition in grey; the systematic ones feed the request to hand over. */
function Tests({ lines, open, title, source }: { lines: Element[]; open: Open; title: string; source: string }) {
  const c = useColors();
  const [paper, setPaper] = useState(false);
  const [shown, more] = useCap(lines);
  const request = lines.filter((x) => !x.condition);
  return (
    <View>
      {shown.map((x, i) => (
        <Pressable key={x.id} accessibilityHint={t("tap_line_hint")} onPress={() => open(x)} className={`gap-[3px] py-3 active:opacity-70 ${i ? "border-t border-line" : ""}`}>
          <Body className="text-[14px] font-medium leading-[20px] text-ink">{x.text}</Body>
          {x.condition ? <Body className="text-[13px] leading-[19px] text-soft">{x.condition}</Body> : null}
        </Pressable>
      ))}
      {more}
      {request.length > 0 ? (
        <View className="gap-3 pb-[10px] pt-1">
          <ActionButton label={t("p_exams_request")} on={paper} onPress={() => setPaper(!paper)} icon={<ClipboardTextIcon size={16} color={c.accentink} />} />
          {paper ? <Paper title={joinMeta([t("p_exams_request"), title])} lines={request.map((x) => x.text)} foot={source} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const DELAY = {
  "immédiat": { key: "p_delay_immediat", frame: "bg-flagbg", ink: "text-flag" },
  "<1h": { key: "p_delay_1h", frame: "bg-flagbg", ink: "text-flag" },
  "<24h": { key: "p_delay_24h", frame: "bg-cautionbg", ink: "text-caution" },
} as const;

/** Where to refer: the criterion (condition), then where (text) and how fast (delay badge). */
function Referrals({ lines, open }: { lines: Element[]; open: Open }) {
  const c = useColors();
  const [shown, more] = useCap(lines);
  return (
    <Card>
      {shown.map((l, i) => (
        <Pressable key={l.id} accessibilityHint={t("tap_line_hint")} onPress={() => open(l)} className={`gap-[5px] py-3 active:opacity-70 ${i ? "border-t border-line" : ""}`}>
          {l.condition ? <Body className="text-[14px] leading-[20px] text-ink">{l.condition}</Body> : null}
          <View className="flex-row items-start gap-2">
            <View className="pt-[3px]">
              <ArrowRightIcon size={14} color={c.accent} weight="bold" />
            </View>
            <Body className="min-w-0 flex-1 text-[14px] font-semibold leading-[20px] text-accentink">{l.text}</Body>
            {l.delai ? (
              <View className={`rounded-full px-[9px] py-[3px] ${DELAY[l.delai].frame}`}>
                <Text className={`text-[11px] font-bold ${DELAY[l.delai].ink}`}>{t(DELAY[l.delai].key)}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
      {more}
    </Card>
  );
}

/** Before a transfer: what must be stable, side by side (all shown, they are read together); then the way. */
function TransferCard({ lines, open }: { lines: Element[]; open: Open }) {
  const before = lines.filter((l) => l.phase === "avant_transfert");
  const during = lines.filter((l) => l.phase === "pendant_transfert");
  return (
    <Card title={before.length ? t("p_transfer_before") : t("p_transfer_during")}>
      {before.length > 0 ? (
        <View className="flex-row flex-wrap gap-2 pb-2 pt-2">
          {before.map((l) => (
            <Pressable key={l.id} accessibilityHint={t("tap_line_hint")} onPress={() => open(l)}
              className="min-h-11 justify-center rounded-inner bg-panel px-3 py-[8px] active:opacity-70" style={{ flexBasis: "47%", flexGrow: 1 }}>
              <Body className="font-mono text-[14px] font-semibold leading-[20px] text-ink">{l.text}</Body>
            </Pressable>
          ))}
        </View>
      ) : null}
      {during.length > 0 ? (
        <View className={before.length ? "border-t border-line pt-3" : ""}>
          {before.length ? <Sub>{t("p_transfer_during")}</Sub> : null}
          <Rows lines={during} open={open} all />
        </View>
      ) : null}
    </Card>
  );
}

/** One display entry with the component the display map names for it. */
function Entry({ e, f, open, inCard }: { e: EntryView; f: Fiche; open: Open; inCard?: boolean }) {
  const c = useColors();
  const [rx, setRx] = useState(false);
  const source = joinMeta([f.meta.sources[0]?.citation, f.meta.sources[0]?.title]);
  const tone = e.entry.tone;
  switch (e.entry.component) {
    case "DecisionCard":
      return <Card><Lines lines={e.lines} open={open} /></Card>;
    case "EssentielCard":
      return <Card><Rows lines={e.lines} open={open} className="text-[14px] font-medium leading-[20px] text-ink" /></Card>;
    case "Checklist":
      return <Checklist lines={e.lines} open={open} />;
    case "StepCards":
      return <StepCards nodes={e.nodes} open={open} />;
    case "Dose":
      return <>{e.doses.map((d) => <Dose key={d.pos.id} d={d} open={open} />)}</>;
    case "Openers":
      return (
        <View className="rounded-card bg-cautionbg px-[18px] pb-[6px] pt-4">
          <Text className="pb-[2px] text-[15px] font-bold text-caution">{t("p_if_contra")}</Text>
          <Rows lines={e.lines} open={open} rule="border-caution/15" className="text-[14px] leading-[20px] text-caution" />
        </View>
      );
    case "Prescription":
      return (
        <View className="gap-3">
          <ActionButton label={t("p_rx_make")} on={rx} onPress={() => setRx(!rx)} icon={<PillIcon size={16} color={c.accentink} />} />
          {rx ? <Paper title={joinMeta([t("p_rx_title"), f.meta.title])} lines={e.lines.map((l) => l.text)} foot={source} /> : null}
        </View>
      );
    case "RedBox":
      return <RedBox lines={e.lines} open={open} />;
    case "Referrals":
      return <Referrals lines={e.lines} open={open} />;
    case "TransferCard":
      return <TransferCard lines={e.lines} open={open} />;
    case "Exams":
      if (e.entry.sub === "examens") {
        const body = <Tests lines={e.lines} open={open} title={f.meta.title} source={source} />;
        return inCard ? body : <Card>{body}</Card>;
      }
    // falls through: clinical exam rows
    case "Recognize":
    case "Rows":
    case "Definitions": {
      const red = tone === "red";
      const rows = (
        <Rows lines={e.lines} open={open} rule={red ? "border-flag/10" : undefined}
          className={red ? "text-[14px] font-medium leading-[20px] text-flag" : tone === "caution" ? "text-[14px] leading-[20px] text-caution" : undefined} />
      );
      return inCard ? rows : <Card>{rows}</Card>;
    }
  }
}

/** Entries that share one card (Reconnaître, Bilans, Suivi): each under its small heading. */
const SHARED_CARD = new Set<BlockId>(["reconnaitre", "bilans", "suivi"]);

function Folded({ entries, f, open }: { entries: EntryView[]; f: Fiche; open: Open }) {
  const c = useColors();
  const [on, setOn] = useState(false);
  const count = entries.reduce((n, e) => n + e.lines.length + e.doses.length + e.nodes.length, 0);
  return (
    <View className="border-t border-line">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setOn(!on)} className="min-h-[52px] flex-row items-center gap-3 py-3 active:opacity-70">
        <Text className={`min-w-0 flex-1 text-[14px] leading-[20px] text-ink ${on ? "font-bold" : "font-medium"}`}>{entries.map(subLabel).join(", ")}</Text>
        <Text className="text-[13px] tabular-nums text-soft">{count}</Text>
        {on ? <CaretDownIcon size={15} color={c.accent} weight="bold" /> : <CaretRightIcon size={15} color={c.muted} weight="bold" />}
      </Pressable>
      {on ? <SharedEntries entries={entries} f={f} open={open} first={false} /> : null}
    </View>
  );
}

function SharedEntries({ entries, f, open, first = true }: { entries: EntryView[]; f: Fiche; open: Open; first?: boolean }) {
  return (
    <>
      {entries.map((e, i) => (
        <View key={`${e.entry.path}:${e.entry.sub}`} className={`pb-[6px] pt-3 ${i || !first ? "border-t border-line" : ""}`}>
          {e.entry.sub === "examens" ? null : <Sub red={e.entry.tone === "red"} caution={e.entry.tone === "caution"}>{subLabel(e)}</Sub>}
          <Entry e={e} f={f} open={open} inCard />
        </View>
      ))}
    </>
  );
}

/** The body of a block: its open entries, and its folded ones as one row. */
export function BlockBody({ b, f, open, all }: { b: BlockView; f: Fiche; open: Open; all?: boolean }) {
  if (b.notCovered) return <NotCovered />;
  const entries = all ? [...b.open, ...b.folded] : b.open;
  if (SHARED_CARD.has(b.id) && (entries.length > 1 || (!all && b.folded.length))) {
    return (
      <Card>
        <SharedEntries entries={entries} f={f} open={open} />
        {!all && b.folded.length ? <Folded entries={b.folded} f={f} open={open} /> : null}
      </Card>
    );
  }
  return (
    <>
      {entries.map((e) => (
        <Entry key={`${e.entry.path}:${e.entry.sub}`} e={e} f={f} open={open} />
      ))}
      {!all && b.folded.length ? (
        <Card>
          <Folded entries={b.folded} f={f} open={open} />
        </Card>
      ) : null}
    </>
  );
}

/** Patient advice can be shared as text. */
export function ShareAdvice({ f, lines }: { f: Fiche; lines: Element[] }) {
  const c = useColors();
  if (!lines.length) return null;
  const message = [f.meta.title, "", ...lines.map((l) => `- ${[l.condition, l.text].filter(Boolean).join(" : ")}`)].join("\n");
  return <ActionButton label={t("p_share_patient")} onPress={() => void Share.share({ message }).catch(() => {})} icon={<ExportIcon size={16} color={c.accentink} />} />;
}

