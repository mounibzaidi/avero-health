import { validateStructure } from "@medguides/schema";

import { FicheScreen } from "@/fiche/FicheScreen";

import seed from "../../../../../content/fiches/embolie-pulmonaire.json";

/** The seed fiche (a test fixture, unpublished) in the real fiche screen. */
export default function DevFiche() {
  const { protocol } = validateStructure(seed);
  return protocol ? <FicheScreen id={protocol.meta.id} fiche={protocol} /> : null;
}
