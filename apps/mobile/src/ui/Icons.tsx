import { BabyIcon } from "phosphor-react-native/src/icons/Baby";
import { FileTextIcon } from "phosphor-react-native/src/icons/FileText";
import { GenderFemaleIcon } from "phosphor-react-native/src/icons/GenderFemale";
import { HeartIcon } from "phosphor-react-native/src/icons/Heart";
import { PlusSquareIcon } from "phosphor-react-native/src/icons/PlusSquare";
import { ThermometerIcon } from "phosphor-react-native/src/icons/Thermometer";
import type { Icon } from "phosphor-react-native";
import { View } from "react-native";

import { useColors } from "./theme";

/**
 * Phosphor icons, imported one file at a time (the package index pulls in every icon).
 * Only the icons the fiche and library screens use.
 */

export { ArrowRightIcon } from "phosphor-react-native/src/icons/ArrowRight";
export { BookOpenIcon } from "phosphor-react-native/src/icons/BookOpen";
export { BrainIcon } from "phosphor-react-native/src/icons/Brain";
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
export { FirstAidIcon } from "phosphor-react-native/src/icons/FirstAid";
export { HeartbeatIcon } from "phosphor-react-native/src/icons/Heartbeat";
export { HospitalIcon } from "phosphor-react-native/src/icons/Hospital";
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
export { StethoscopeIcon } from "phosphor-react-native/src/icons/Stethoscope";
export { TargetIcon } from "phosphor-react-native/src/icons/Target";
export { UserIcon } from "phosphor-react-native/src/icons/User";
export { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
export { VirusIcon } from "phosphor-react-native/src/icons/Virus";
export { XIcon } from "phosphor-react-native/src/icons/X";
export { WarningIcon } from "phosphor-react-native/src/icons/Warning";
export { BabyIcon, GenderFemaleIcon, ThermometerIcon };
export type { Icon };

const CATEGORY: Record<string, Icon> = {
  Urgences: PlusSquareIcon,
  Chronique: HeartIcon,
  Aigu: ThermometerIcon,
  Pédiatrie: BabyIcon,
  Femme: GenderFemaleIcon,
};

/** The specialty icon on a soft teal tile (32 px, radius 9). All category icons are teal. */
export function IconTile({ category, size = 32 }: { category: string; size?: number }) {
  const c = useColors();
  const Glyph = CATEGORY[category] ?? FileTextIcon;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28 }} className="items-center justify-center bg-tint">
      <Glyph size={Math.round(size * 0.53)} color={c.accent} />
    </View>
  );
}
