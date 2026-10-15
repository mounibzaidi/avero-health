/** Writes protocol.schema.json, the JSON Schema of a Protocol v1.1. */
import { writeFileSync } from "node:fs";

import { protocolJsonSchema } from "../src/json-schema.ts";

const out = new URL("../../protocol.schema.json", import.meta.url);
writeFileSync(out, JSON.stringify(protocolJsonSchema(), null, 2) + "\n");
console.log("wrote protocol.schema.json");
