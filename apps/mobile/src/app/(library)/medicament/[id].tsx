import { useLocalSearchParams } from "expo-router";

import { SubstanceScreen } from "@/library/Substance";

export default function SubstanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SubstanceScreen id={decodeURIComponent(id ?? "")} />;
}
