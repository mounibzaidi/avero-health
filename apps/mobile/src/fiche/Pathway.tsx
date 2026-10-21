import type { Pathway as PathwayData, PathwayNode } from "@avero/schema";
import { breakpoint } from "@avero/ui-tokens";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { t } from "@/strings/fr";
import { ArrowRightIcon, CheckIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body } from "@/ui/ui";

import { Card, ItemRows } from "./parts";
import { tabsOf, timeline, type Note, type Step } from "./timeline";

/** Nodes top to bottom: from the start, each node before the ones it leads to (breadth first). */
export function orderNodes(p: PathwayData): PathwayNode[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const out: PathwayNode[] = [];
  const seen = new Set<string>();
  const queue = p.start_node_id && byId.has(p.start_node_id) ? [p.start_node_id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id)!;
    out.push(n);
    for (const b of n.branches) if (b.next_node_id && byId.has(b.next_node_id)) queue.push(b.next_node_id);
  }
  return out;
}

/** A tree whose start is a question with several answers: those answers are the tabs. */
const tabbed = (start: PathwayNode | undefined): start is PathwayNode => !!start && start.type === "decision" && start.branches.length > 1;

/** A choice as a pill: the profile tabs, and the answers of a question inside a tab. */
function Pill({ label, on, role, onPress, onLayout }: { label: string; on: boolean; role: "tab" | "radio"; onPress: () => void; onLayout?: (x: number) => void }) {
  return (
    <Pressable accessibilityRole={role} accessibilityState={{ selected: on }} onPress={onPress} onLayout={onLayout && ((e) => onLayout(e.nativeEvent.layout.x))}
      className={`min-h-10 justify-center rounded-full px-3 active:opacity-70 ${on ? "bg-tint" : "border border-line bg-surface"} ${role === "radio" ? "max-w-full py-[6px]" : ""}`}>
      {/* a long answer in a tab wraps inside its pill; the tab bar scrolls instead */}
      <Text className={`text-[13px] ${on ? "font-semibold text-accentink" : "font-medium text-soft"}`}>{label}</Text>
    </Pressable>
  );
}

/** What an answer leads to when it does not continue the line: success, another step, another tab. */
function NoteRow({ note, onTab }: { note: Note; onTab: (tab: string) => void }) {
  const c = useColors();
  const { branch } = note;
  switch (note.kind) {
    case "success":
      return (
        <View className="flex-row items-center gap-[6px] self-start rounded-full bg-tint px-3 py-[6px]">
          <CheckIcon size={13} color={c.accent} weight="bold" />
          <Text className="shrink text-[12.5px] font-semibold leading-[17px] text-accentink">{t("f_success", { l: branch.label })}</Text>
        </View>
      );
    case "jump":
      return (
        <View className="flex-row flex-wrap items-center gap-x-[6px]">
          <Text className="text-[12.5px] leading-[17px] text-soft">{branch.label}</Text>
          <ArrowRightIcon size={12} color={c.accent} weight="bold" />
          <Text className="text-[12.5px] font-semibold leading-[17px] text-accentink">{t("f_step_n", { n: note.step })}</Text>
        </View>
      );
    case "link": {
      // the tab's own start needs no name; a step further in it is named
      const where = note.node.id === note.tab.next_node_id || !note.node.question ? note.tab.label : `${note.tab.label} · ${note.node.question}`;
      return (
        <View className="gap-1">
          <Text className="text-[12.5px] leading-[17px] text-soft">{branch.label}</Text>
          <Pressable accessibilityRole="link" onPress={() => onTab(note.tab.id)}
            className="min-h-9 flex-row items-center gap-[6px] self-start rounded-full border border-accent/30 px-3 active:opacity-70">
            <ArrowRightIcon size={12} color={c.accent} weight="bold" />
            <Text className="shrink text-[12.5px] font-semibold leading-[17px] text-accentink">{where}</Text>
          </Pressable>
        </View>
      );
    }
    case "none":
      return <Text className="text-[12.5px] leading-[17px] text-soft">{branch.label}</Text>;
  }
}

/** One step of the timeline: its number on the line, its title and lines, a question's answers, its notes. The line
 * runs down to the next step, the answer that leads there written on it. */
function StepRow({ step, last, onChoose, onTab }: { step: Step; last: boolean; onChoose: (branch: string) => void; onTab: (tab: string) => void }) {
  const { node, decision, notes, caption } = step;
  const title = node.question || (node.type === "end" ? t("f_end") : null);
  return (
    <>
      {caption ? (
        <View className="flex-row gap-3">
          <View className="w-[26px] items-center"><View className="w-px flex-1 bg-line" /></View>
          <Text className="min-w-0 flex-1 py-[6px] text-[12.5px] font-medium leading-[17px] text-muted">
            {caption.from ? t("f_from_step", { n: caption.from, l: caption.label }) : caption.label}
          </Text>
        </View>
      ) : null}
      <View className="flex-row gap-3">
        <View className="w-[26px] items-center">
          <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-tint">
            <Text className="text-[12.5px] font-bold text-accent">{step.n}</Text>
          </View>
          {last ? null : <View className="w-px flex-1 bg-line" />}
        </View>
        <View className={`min-w-0 flex-1 gap-2 ${last ? "pb-1" : "pb-4"}`}>
          {title ? <Body className="pt-[2px] text-[14.5px] font-bold leading-[21px]">{title}</Body> : null}
          {node.items.length ? <View className={title ? "-mt-2" : "-mt-3"}><ItemRows items={node.items} /></View> : null}
          {decision ? (
            <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
              {decision.choices.map((b) => <Pill key={b.id} label={b.label} on={b.id === decision.chosen} role="radio" onPress={() => onChoose(b.id)} />)}
            </View>
          ) : null}
          {notes.length ? <View className="gap-2">{notes.map((x) => <NoteRow key={x.branch.id} note={x} onTab={onTab} />)}</View> : null}
        </View>
      </View>
    </>
  );
}

/**
 * The start question's answers as tabs (scrolling on a phone, wrapping on a wide screen). In a tab, its tree as one
 * open timeline (timeline.ts); only a question shows one answer's sub-path at a time, the first until another is
 * chosen. Each tab keeps its own answers. A link to another tab opens it and brings the tree back into view.
 */
function PathTabs({ pathway, start, onTop }: { pathway: PathwayData; start: PathwayNode; onTop: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.ficheWide;
  const { tabs } = useMemo(() => tabsOf(pathway, start), [pathway, start]);
  const [sel, setSel] = useState<string | null>(null);
  const tab = tabs.find((x) => x.id === sel) ?? tabs[0];
  // per tab: question node id → the answer chosen there
  const [choices, setChoices] = useState<Record<string, Record<string, string>>>({});
  const chosen = useMemo(() => (tab ? choices[tab.id] ?? {} : {}), [tab, choices]);
  const steps = useMemo(() => (tab ? timeline(pathway, start, tab, chosen) : []), [pathway, start, tab, chosen]);
  // on a phone the tab bar scrolls: the tab opened (from a link too) is brought into view
  const bar = useRef<ScrollView>(null);
  const tabX = useRef<Record<string, number>>({});
  const tabId = tab?.id;
  useEffect(() => {
    if (tabId) bar.current?.scrollTo({ x: Math.max(0, (tabX.current[tabId] ?? 0) - 18), animated: true });
  }, [tabId]);
  if (!tab) return null;

  const openTab = (id: string) => {
    setSel(id);
    onTop();
  };
  const tabButtons = tabs.map((x) => <Pill key={x.id} label={x.label} on={x.id === tab.id} role="tab" onPress={() => setSel(x.id)} onLayout={(px) => (tabX.current[x.id] = px)} />);
  return (
    <Card title={t("f_pathway")}>
      {start.question ? <Body className="pt-1 text-[14.5px] font-semibold leading-[21px]">{start.question}</Body> : null}
      {start.items.length ? <ItemRows items={start.items} /> : null}
      {wide ? (
        <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2 py-3">{tabButtons}</View>
      ) : (
        <ScrollView ref={bar} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" className="-mx-[18px] grow-0" contentContainerClassName="gap-2 px-[18px] py-3">
          {tabButtons}
        </ScrollView>
      )}
      <View className="pb-3 pt-1">
        {steps.map((s, i) => (
          <StepRow key={s.node.id} step={s} last={i === steps.length - 1} onTab={openTab}
            onChoose={(b) => setChoices({ ...choices, [tab.id]: { ...chosen, [s.node.id]: b } })} />
        ))}
      </View>
    </Card>
  );
}

/** The decision pathway: a timeline per tab when it starts with a question, else numbered steps with each step's
 * question, its items, and where each answer leads. `onTop(y)`: scroll the fiche to the tree, `y` its place in its
 * section. */
export function Pathway({ pathway, onTop }: { pathway: PathwayData; onTop?: (y: number) => void }) {
  const c = useColors();
  const y = useRef(0);
  const nodes = orderNodes(pathway);
  if (!nodes.length) return null;
  const start = nodes[0];
  if (tabbed(start)) {
    return (
      <View onLayout={(e) => (y.current = e.nativeEvent.layout.y)}>
        <PathTabs pathway={pathway} start={start} onTop={() => onTop?.(y.current)} />
      </View>
    );
  }
  const step = new Map(nodes.map((n, i) => [n.id, i + 1]));
  return (
    <Card title={t("f_pathway")}>
      {nodes.map((n, i) => {
        const title = n.question || (n.type === "end" ? t("f_end") : null);
        return (
        <View key={n.id} className={`gap-2 py-3 ${i ? "border-t border-line" : ""}`}>
          <View className="flex-row items-start gap-3">
            <View className={`h-[26px] w-[26px] items-center justify-center rounded-full ${n.type === "end" ? "bg-panel" : "bg-tint"}`}>
              <Text className="text-[12.5px] font-bold text-accentink">{i + 1}</Text>
            </View>
            {title ? (
              <Body className="min-w-0 flex-1 pt-[2px] text-[14.5px] font-semibold leading-[21px]">{title}</Body>
            ) : (
              <View className="-mt-3 min-w-0 flex-1"><ItemRows items={n.items} /></View>
            )}
          </View>
          {title && n.items.length ? <View className="ps-[38px]"><ItemRows items={n.items} /></View> : null}
          {n.branches.length ? (
            <View className="gap-[6px] ps-[38px]">
              {n.branches.map((b) => (
                <View key={b.id} className="flex-row items-center gap-2 rounded-branch bg-panel px-3 py-[9px]">
                  <Body className="min-w-0 flex-1 text-[13.5px] font-medium leading-[19px]">{b.label}</Body>
                  <ArrowRightIcon size={13} color={c.accent} weight="bold" />
                  <Text className="text-[13px] font-semibold text-accentink">
                    {b.next_node_id && step.has(b.next_node_id) ? t("f_step_n", { n: step.get(b.next_node_id)! }) : ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        );
      })}
    </Card>
  );
}
