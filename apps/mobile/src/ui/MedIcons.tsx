import { createElement, type ComponentType } from "react";
import type { SvgProps } from "react-native-svg";

// Health Icons (healthicons.org, CC0), the outline set drawn on 48 px: shrunk to 15 to 30 px its lines are as fine as
// the Phosphor icons' (the 24 px set is twice as thick). Imported one file at a time:
// the package's index would bring all 270 of them.
import AmbulanceSvg from "healthicons-react-native/dist/outline/Ambulance";
import BabySvg from "healthicons-react-native/dist/outline/Baby0203m";
import BloodPressureSvg from "healthicons-react-native/dist/outline/BloodPressureMonitor";
import GlucoseMeterSvg from "healthicons-react-native/dist/outline/DiabetesMeasure";
import HeartCardiogramSvg from "healthicons-react-native/dist/outline/HeartCardiogram";
import HospitalSvg from "healthicons-react-native/dist/outline/Hospital";
import KidneysSvg from "healthicons-react-native/dist/outline/Kidneys";
import LiverSvg from "healthicons-react-native/dist/outline/Liver";
import LungsSvg from "healthicons-react-native/dist/outline/Lungs";
import MedicinesSvg from "healthicons-react-native/dist/outline/Medicines";
import MentalHealthSvg from "healthicons-react-native/dist/outline/MentalHealth";
import NeurologySvg from "healthicons-react-native/dist/outline/Neurology";
import PregnantSvg from "healthicons-react-native/dist/outline/Pregnant";
import StethoscopeSvg from "healthicons-react-native/dist/outline/Stethoscope";
import StomachSvg from "healthicons-react-native/dist/outline/Stomach";
import VirusSvg from "healthicons-react-native/dist/outline/VirusAlt";

/** A medical icon, sized and coloured like a Phosphor one (`size`, `color`). */
export type MedIcon = ComponentType<{ size?: number; color?: string }>;

const med = (Svg: ComponentType<SvgProps>): MedIcon =>
  function Med({ size = 24, color }) {
    return <Svg width={size} height={size} color={color} />;
  };

export const AmbulanceIcon = med(AmbulanceSvg);
export const BloodPressureIcon = med(BloodPressureSvg);
export const HospitalMedIcon = med(HospitalSvg);
export const MedicinesIcon = med(MedicinesSvg);
export const StethoscopeMedIcon = med(StethoscopeSvg);

/** A specialty's icon, from its name as fiches write it ("cardiologie", "Cardiovasculaire", "endocrinologie"…). */
const SPECIALTY: [RegExp, MedIcon, string][] = [
  [/urgence|trauma|toxico/i, AmbulanceIcon, "Urgences"],
  [/cardio|vascul/i, med(HeartCardiogramSvg), "Cardiologie"],
  [/neuro/i, med(NeurologySvg), "Neurologie"],
  [/pneumo|respir|poumon/i, med(LungsSvg), "Pneumologie"],
  [/n[ée]phro|r[ée]nal|rein/i, med(KidneysSvg), "Néphrologie"],
  [/endocr|diab|m[ée]tabol/i, med(GlucoseMeterSvg), "Endocrinologie"],
  [/obst[ée]tr|gyn[ée]co|grossesse|femme/i, med(PregnantSvg), "Obstétrique, gynécologie"],
  [/p[ée]diatr|enfant|nouveau/i, med(BabySvg), "Pédiatrie"],
  [/infect|choc|virus/i, med(VirusSvg), "Infectiologie"],
  [/gastro|digest/i, med(StomachSvg), "Gastro-entérologie"],
  [/h[ée]pato|foie/i, med(LiverSvg), "Hépatologie"],
  [/psych|mental/i, med(MentalHealthSvg), "Psychiatrie"],
  [/hta|hypertension|tension/i, BloodPressureIcon, "Hypertension"],
];
export const specialtyIcon = (name: string): MedIcon => SPECIALTY.find(([re]) => re.test(name))?.[1] ?? StethoscopeMedIcon;
/** Every specialty icon with a sample name, and the default (for the icons page). */
export const SPECIALTY_ICONS: [string, MedIcon][] = [...SPECIALTY.map(([, icon, label]): [string, MedIcon] => [label, icon]), ["Autre (par défaut)", StethoscopeMedIcon]];

/** A specialty's icon as a component, by name ("cardiologie", "Urgences"…). */
export function SpecialtyIcon({ name, size, color }: { name: string; size?: number; color?: string }) {
  return createElement(specialtyIcon(name), { size, color });
}
