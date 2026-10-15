import { z } from "zod";

import { Protocol } from "./schema.ts";

/** The JSON Schema of a Protocol v1.1, generated from the Zod schema (written to protocol.schema.json by `npm run json-schema`). */
export function protocolJsonSchema() {
  return z.toJSONSchema(Protocol, { io: "input" });
}
