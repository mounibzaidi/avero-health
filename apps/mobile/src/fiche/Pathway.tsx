import type { Pathway as PathwayData, PathwayNode } from "@medguides/schema";
import { Text, View } from "react-native";

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

/** The decision pathway as numbered steps: each step's question, its items, and where each answer leads. */
export function Pathway({ pathway }: { pathway: PathwayData }) {
  const c = useColors();
  const nodes = orderNodes(pathway);
  if (!nodes.length) return null;
  const step = new Map(nodes.map((n, i) => [n.id, i + 1]));
  return (
    <Card title={t("f_pathway")}>
      {nodes.map((n, i) => (
        <View key={n.id} className={`gap-2 py-3 ${i ? "border-t border-line" : ""}`}>
          <View className="flex-row items-start gap-3">
            <View className={`h-[26px] w-[26px] items-center justify-center rounded-full ${n.type === "end" ? "bg-panel" : "bg-tint"}`}>
              <Text className="text-[12.5px] font-bold text-accentink">{i + 1}</Text>
            </View>
            <Body className="min-w-0 flex-1 pt-[2px] text-[14.5px] font-semibold leading-[21px]">
              {n.question || (n.type === "end" ? t("f_end") : "")}
            </Body>
          </View>
          {n.items.length ? <View className="ps-[38px]"><ItemRows items={n.items} /></View> : null}
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
      ))}
    </Card>
  );
}
