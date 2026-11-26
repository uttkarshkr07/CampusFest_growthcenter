// Builds the Gemini function declarations from the engine catalog. The result is committed as
// declarations.json so the Worker does not spend its CPU allowance building it on each request.
// Regenerate after changing the catalog:  UPDATE_DECLARATIONS=1 npx vitest run tests/copilot_loop.test.ts
import { z } from "zod";
import { catalog, type ToolName } from "@/lib/engine/catalog";
import { APP_TARGETS, APP_TARGET_KEYS } from "./targets";
import { OPEN_IN_APP, PROPOSE_TASK } from "./tool-defs.names";

export const MODEL_TOOLS: ToolName[] = [
  "funnel", "targetsVsActuals", "campaignTable", "flags", "projection", "pace", "momentum", "showupDrivers",
  "query", "actionList", "whatIf", "searchPeople", "person", "tasks", "dataHealth", "eventInfo",
];

export { PROPOSE_TASK, OPEN_IN_APP };

export interface Declaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

const KEEP = new Set(["type", "description", "enum", "properties", "required", "items", "minItems", "maxItems", "minimum", "maximum"]);

/** Gemini accepts only a subset of JSON Schema. */
function sanitise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitise);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties") out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, s]) => [name, sanitise(s)]));
    else if (k === "enum" || k === "required") out[k] = v;
    else if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) > 1e9) continue;
    else out[k] = sanitise(v);
  }
  return out;
}

export function buildDeclarations(): Declaration[] {
  const fromCatalog = MODEL_TOOLS.map((name): Declaration => {
    const entry = catalog[name];
    const schema = sanitise(z.toJSONSchema(entry.input as z.ZodType, { io: "input" })) as { properties?: Record<string, unknown>; required?: string[] };
    if (schema.required) {
      schema.required = schema.required.filter((r) => r !== "asOf"); // filled in with the selected date
      if (!schema.required.length) delete schema.required;
    }
    if (schema.properties?.asOf) schema.properties.asOf = { type: "string", description: "Optional YYYY-MM-DD; default is the selected date." };
    const hasProps = schema.properties && Object.keys(schema.properties).length > 0;
    return { name, description: entry.description, ...(hasProps ? { parameters: schema as Record<string, unknown> } : {}) };
  });
  return [
    ...fromCatalog,
    {
      name: PROPOSE_TASK,
      description: "Show the user a draft of ONE new task to review, edit and confirm. Nothing is saved until they confirm.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short action, under 90 characters." },
          description: { type: "string", description: "What to do and how success will be checked." },
          campaignId: { type: "string", description: "Campaign id this is about, if any." },
          ownerId: { type: "string", description: "owner_id from the team list, if clear." },
          dueDate: { type: "string", description: "YYYY-MM-DD, after the selected date." },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string", description: "Why, in one or two sentences." },
          evidence: { type: "array", items: { type: "string" }, description: "The figures this rests on, copied from the summary or tool results." },
        },
        required: ["title", "description", "reason", "evidence"],
      },
    },
    {
      name: OPEN_IN_APP,
      description: `Show a 'Take me there' button for a change you cannot make yourself. Targets: ${APP_TARGET_KEYS.map((k) => `${k} = ${APP_TARGETS[k].help}`).join("; ")}.`,
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", enum: APP_TARGET_KEYS },
          id: { type: "string" },
          label: { type: "string", description: "Button text, a few words." },
        },
        required: ["target", "label"],
      },
    },
  ];
}
