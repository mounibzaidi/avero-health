import type { Icon } from "phosphor-react-native";
import { View } from "react-native";

import { SpecialtyIcon } from "./MedIcons";
import { useColors } from "./theme";

/**
 * Phosphor icons, imported one file at a time (the package index pulls in every icon).
 * Only the icons the fiche and library screens use.
 */

export { ArrowRightIcon } from "phosphor-react-native/src/icons/ArrowRight";
export { BookOpenIcon } from "phosphor-react-native/src/icons/BookOpen";
export { CalendarCheckIcon } from "phosphor-react-native/src/icons/CalendarCheck";
export { CaretDownIcon } from "phosphor-react-native/src/icons/CaretDown";
export { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
export { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
export { CaretUpIcon } from "phosphor-react-native/src/icons/CaretUp";
export { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
export { CheckIcon } from "phosphor-react-native/src/icons/Check";
export { ClipboardTextIcon } from "phosphor-react-native/src/icons/ClipboardText";
export { ClockIcon } from "phosphor-react-native/src/icons/Clock";
export { ExportIcon } from "phosphor-react-native/src/icons/Export";
export { FilePdfIcon } from "phosphor-react-native/src/icons/FilePdf";
export { HouseIcon } from "phosphor-react-native/src/icons/House";
export { InfoIcon } from "phosphor-react-native/src/icons/Info";
export { LightningIcon } from "phosphor-react-native/src/icons/Lightning";
export { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
export { MapPinIcon } from "phosphor-react-native/src/icons/MapPin";
export { PillIcon } from "phosphor-react-native/src/icons/Pill";
export { ProhibitIcon } from "phosphor-react-native/src/icons/Prohibit";
export { QuotesIcon } from "phosphor-react-native/src/icons/Quotes";
export { SealCheckIcon } from "phosphor-react-native/src/icons/SealCheck";
export { ShieldCheckIcon } from "phosphor-react-native/src/icons/ShieldCheck";
export { TableIcon } from "phosphor-react-native/src/icons/Table";
export { StarIcon } from "phosphor-react-native/src/icons/Star";
export { TargetIcon } from "phosphor-react-native/src/icons/Target";
export { UserIcon } from "phosphor-react-native/src/icons/User";
export { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
export { XIcon } from "phosphor-react-native/src/icons/X";
export { WarningIcon } from "phosphor-react-native/src/icons/Warning";
export type { Icon };


/** The specialty icon (Health Icons, by the specialty's name or "Urgences") on a soft teal tile (32 px, radius 9). */
export function IconTile({ category, size = 32 }: { category: string; size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28 }} className="items-center justify-center bg-tint">
      <SpecialtyIcon name={category} size={Math.round(size * 0.62)} color={c.accent} />
    </View>
  );
}
