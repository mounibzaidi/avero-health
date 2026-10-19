import { shadow } from "@avero/ui-tokens";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { t } from "@/strings/fr";

import { MagnifyingGlassIcon, XIcon } from "./Icons";
import { useColors, usePlaceholderColor } from "./theme";
import { SURFACE_STYLE } from "./ui";

/** The search field. Focus draws a teal edge and a soft teal ring. */
export function SearchField({ value, onChange, onSubmit, compact, autoFocus, placeholder: label }: {
  value: string; onChange: (v: string) => void; onSubmit?: () => void; compact?: boolean; autoFocus?: boolean; placeholder?: string;
}) {
  const c = useColors();
  const placeholder = usePlaceholderColor();
  const [focus, setFocus] = useState(false);
  return (
    <View style={focus ? { boxShadow: shadow.searchFocus } : SURFACE_STYLE}
      className={`flex-row items-center gap-[10px] rounded-xl border bg-surface ${focus ? "border-accent/55" : "border-edge/[0.06]"} ${compact ? "h-10 px-3" : "h-[50px] px-4"}`}>
      <View className="shrink-0">
        <MagnifyingGlassIcon size={18} color={focus ? c.accent : placeholder} />
      </View>
      <TextInput value={value} onChangeText={onChange} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onSubmitEditing={onSubmit}
        autoFocus={autoFocus} autoCorrect={false} placeholder={label ?? (compact ? t("search_label") : t("search_fiches"))} placeholderTextColor={placeholder}
        accessibilityLabel={t("search_fiches")} returnKeyType="search"
        className={`h-full min-w-0 flex-1 text-ink outline-none ${compact ? "text-[14px]" : "text-[15px]"}`} />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("clear")} onPress={() => onChange("")} className="h-full w-8 items-center justify-center hover:opacity-70">
          <XIcon size={16} color={placeholder} />
        </Pressable>
      ) : null}
    </View>
  );
}
