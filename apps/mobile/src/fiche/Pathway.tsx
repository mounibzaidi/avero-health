import type { Pathway as PathwayData, PathwayNode } from "@avero/schema";
import { breakpoint } from "@avero/ui-tokens";
import { useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { t } from "@/strings/fr";
import { ArrowRightIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body } from "@/ui/ui";

import { Card, ItemRows } from "./parts";

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

/** One node as a card: an action is a step (title, its lines), a question its question, an end the final card. Its
 * answers follow as buttons, the one chosen highlighted. */
function StepCard({ node, chosen, onChoose }: { node: PathwayNode; chosen: string | undefined; onChoose: (branch: string) => void }) {
  const c = useColors();
  const end = node.type === "end";
  const title = node.question || (end ? t("f_end") : null);
  return (
    <View className={`gap-2 rounded-inner border px-3 py-3 ${end ? "border-accent/20 bg-tint/40" : "border-line bg-surface"}`}>
      {title ? <Body className={`text-[14.5px] leading-[21px] ${node.type === "decision" ? "font-semibold" : "font-bold"}`}>{title}</Body> : null}
      {node.items.length ? <View className={title ? "-mt-2" : "-my-2"}><ItemRows items={node.items} /></View> : null}
      {!end && node.branches.length ? (
        <View className="gap-[6px]">
          {node.branches.map((b) => {
            const on = b.id === chosen;
            return (
              <Pressable key={b.id} accessibilityRole="button" accessibilityState={{ selected: on }} disabled={!b.next_node_id} onPress={() => onChoose(b.id)}
                className={`min-h-11 flex-row items-center gap-2 rounded-branch border px-3 py-[9px] active:opacity-70 ${on ? "border-accent/40 bg-tint" : "border-transparent bg-panel"}`}>
                <Text className={`min-w-0 flex-1 text-[13.5px] leading-[19px] ${on ? "font-semibold text-accentink" : "font-medium text-ink"}`}>{b.label}</Text>
                <ArrowRightIcon size={13} color={c.accent} weight="bold" />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The start question's answers as tabs (scrolling on a phone, wrapping on a wide screen). In a tab, its node's card,
 * then, answer by answer, the node each chosen answer leads to, even a node of another tab (shown here, the tab stays).
 * Each tab keeps its own path; "Recommencer" folds it back to its first card.
 */
function PathTabs({ pathway, start }: { pathway: PathwayData; start: PathwayNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.ficheWide;
  const byId = new Map(pathway.nodes.map((n) => [n.id, n]));
  const tabs = start.branches.filter((b) => b.next_node_id && byId.has(b.next_node_id));
  const [sel, setSel] = useState<string | null>(null);
  const tab = tabs.find((x) => x.id === sel) ?? tabs[0];
  // per tab: node id → the answer chosen there
  const [choices, setChoices] = useState<Record<string, Record<string, string>>>({});
  if (!tab) return null;
  const chosen = choices[tab.id] ?? {};

  // the cards shown: from the tab's node, following the chosen answers (a node already shown ends the walk)
  const steps: PathwayNode[] = [];
  for (let n = byId.get(tab.next_node_id!); n && !steps.includes(n); ) {
    steps.push(n);
    const b = n.branches.find((x) => x.id === chosen[n!.id]);
    n = b?.next_node_id ? byId.get(b.next_node_id) : undefined;
  }
  /** An answer chosen at one card: the choices of the cards below it are dropped. */
  const choose = (at: number, branch: string) => {
    const kept = Object.fromEntries(steps.slice(0, at).map((n) => [n.id, chosen[n.id]]));
    setChoices({ ...choices, [tab.id]: { ...kept, [steps[at].id]: branch } });
  };

  const tabButtons = tabs.map((x) => {
    const on = x.id === tab.id;
    return (
      <Pressable key={x.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setSel(x.id)}
        className={`min-h-10 justify-center rounded-full px-3 active:opacity-70 ${on ? "bg-tint" : "border border-line bg-surface"}`}>
        <Text className={`text-[13px] ${on ? "font-semibold text-accentink" : "font-medium text-soft"}`}>{x.label}</Text>
      </Pressable>
    );
  });
  return (
    <Card title={t("f_pathway")}>
      {start.question ? <Body className="pt-1 text-[14.5px] font-semibold leading-[21px]">{start.question}</Body> : null}
      {start.items.length ? <ItemRows items={start.items} /> : null}
      {wide ? (
        <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2 py-3">{tabButtons}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" className="-mx-[18px] grow-0" contentContainerClassName="gap-2 px-[18px] py-3">
          {tabButtons}
        </ScrollView>
      )}
      <View className="gap-2 pb-3">
        {steps.map((n, i) => <StepCard key={n.id} node={n} chosen={chosen[n.id]} onChoose={(b) => choose(i, b)} />)}
        {steps.length > 1 ? (
          <Pressable accessibilityRole="button" onPress={() => setChoices({ ...choices, [tab.id]: {} })} className="min-h-10 justify-center self-start px-1 active:opacity-60">
            <Text className="text-[13px] font-semibold text-accent">{t("f_restart")}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

/** The decision pathway: tabs walked answer by answer when it starts with a question, else numbered steps with each
 * step's question, its items, and where each answer leads. */
export function Pathway({ pathway }: { pathway: PathwayData }) {
  const c = useColors();
  const nodes = orderNodes(pathway);
  if (!nodes.length) return null;
  const start = nodes[0];
  if (tabbed(start)) return <PathTabs pathway={pathway} start={start} />;
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
