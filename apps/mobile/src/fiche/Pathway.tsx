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

/** Longest chain behind an answer that still reads as one path (the end node included). */
const CHAIN_MAX = 3;

/**
 * One question whose answers each lead to an end, straight or through a short chain of single-way steps: the paths,
 * one per answer, or null for a real multi-step tree.
 */
export function asPaths(p: PathwayData): { start: PathwayNode; paths: { id: string; label: string; nodes: PathwayNode[] }[] } | null {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const start = p.start_node_id ? byId.get(p.start_node_id) : undefined;
  if (!start || start.type !== "decision" || start.branches.length < 2) return null;
  const paths = [];
  for (const b of start.branches) {
    const nodes: PathwayNode[] = [];
    let n = b.next_node_id ? byId.get(b.next_node_id) : undefined;
    while (n && nodes.length < CHAIN_MAX && !nodes.includes(n) && n !== start) {
      nodes.push(n);
      if (n.type === "end") break;
      if (n.branches.length !== 1) return null;
      n = n.branches[0].next_node_id ? byId.get(n.branches[0].next_node_id) : undefined;
    }
    if (nodes.at(-1)?.type !== "end") return null;
    paths.push({ id: b.id, label: b.label, nodes });
  }
  return { start, paths };
}

/** One question, its answers as tabs (scrolling on a phone, wrapping on a wide screen), the chosen path's lines. */
function PathTabs({ start, paths }: NonNullable<ReturnType<typeof asPaths>>) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.ficheWide;
  // the answer chosen, by its id: the first one to start with, kept while the screen scrolls and re-renders
  const [sel, setSel] = useState<string | null>(null);
  const path = paths.find((x) => x.id === sel) ?? paths[0];
  const tabs = paths.map((x) => {
    const on = x.id === path.id;
    return (
      <Pressable key={x.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setSel(x.id)}
        className={`min-h-10 justify-center rounded-full px-3 active:opacity-70 ${on ? "bg-tint" : "border border-line bg-surface"}`}>
        <Text className={`text-[13px] ${on ? "font-semibold text-accentink" : "font-medium text-soft"}`}>{x.label}</Text>
      </Pressable>
    );
  });
  const lines = path.nodes.filter((n) => n.items.length || (n.question && n.question !== path.label));
  return (
    <Card title={t("f_pathway")}>
      {start.question ? <Body className="pt-1 text-[14.5px] font-semibold leading-[21px]">{start.question}</Body> : null}
      {start.items.length ? <ItemRows items={start.items} /> : null}
      {wide ? (
        <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2 py-3">{tabs}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" className="-mx-[18px] grow-0" contentContainerClassName="gap-2 px-[18px] py-3">
          {tabs}
        </ScrollView>
      )}
      {lines.length ? lines.map((n) => (
        <View key={n.id} className="border-t border-line pt-2">
          {n.question && n.question !== path.label ? <Text className="pt-1 text-[13px] font-semibold text-soft">{n.question}</Text> : null}
          <ItemRows items={n.items} />
        </View>
      )) : <Text className="border-t border-line py-3 text-[13px] text-muted">{t("f_end")}</Text>}
    </Card>
  );
}

/** The decision pathway: tabs when it is one question with a path per answer, else numbered steps with each step's
 * question, its items, and where each answer leads. */
export function Pathway({ pathway }: { pathway: PathwayData }) {
  const c = useColors();
  const tabs = asPaths(pathway);
  const nodes = orderNodes(pathway);
  if (!nodes.length) return null;
  if (tabs) return <PathTabs {...tabs} />;
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
