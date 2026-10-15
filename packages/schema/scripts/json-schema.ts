/** Writes fiche.schema.json (JSON Schema of the Fiche) for the Python service. */
import { writeFileSync } from "node:fs";
import { z } from "zod";

import { Fiche } from "../src/schema.ts";

const out = new URL("../../fiche.schema.json", import.meta.url);
writeFileSync(out, JSON.stringify(z.toJSONSchema(Fiche, { io: "input" }), null, 2) + "\n");
console.log("wrote fiche.schema.json");
