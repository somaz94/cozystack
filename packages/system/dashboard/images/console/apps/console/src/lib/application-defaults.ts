import { getDefaultFormState, type RJSFSchema, type UiSchema, type Experimental_DefaultFormStateBehavior } from "@rjsf/utils"
import validator from "@rjsf/validator-ajv8"
import { sanitizeSchema } from "./keys-order.ts"

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function parseApplicationDefaults(raw: string): Record<string, Record<string, unknown>> {
  const value: unknown = JSON.parse(raw)
  if (!isObject(value)) throw new Error("defaults.json must be an object keyed by application plural")
  for (const [plural, spec] of Object.entries(value)) {
    if (!plural || plural.startsWith("_") || !isObject(spec)) {
      throw new Error(`"${plural}" must name an application plural with an object value`)
    }
    for (const key of Object.keys(spec)) {
      if (key.startsWith("_")) throw new Error(`Field "${key}" is reserved`)
    }
  }
  return value as Record<string, Record<string, unknown>>
}

export function fillMissing(
  spec: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ ...defaults, ...spec }).map(([key, fallback]) => {
    const value = spec[key]
    if (!Object.hasOwn(spec, key)) return [key, fallback]
    if (isObject(value) && Object.keys(value).length > 0 && isObject(defaults[key])) {
      return [key, fillMissing(value, defaults[key])]
    }
    return [key, value]
  }))
}

export function prepareCreationSpec(
  openAPISchema: string,
  spec: unknown,
  installationDefaults: Record<string, unknown>,
): Record<string, unknown> {
  if (!isObject(spec)) throw new Error("Application spec must be an object")
  const merged = fillMissing(spec, installationDefaults)
  if (!openAPISchema) return merged
  const schema = sanitizeSchema(JSON.parse(openAPISchema)) as RJSFSchema
  const populated = getDefaultFormState(validator, schema, merged, schema)
  return fillMissing(merged, isObject(populated) ? populated : {})
}

// Keep item defaults for new rows and map entries; the create page defaults
// declared object fields without refilling explicitly empty objects.
export function withoutFormDefaults(schema: unknown): unknown {
  if (!isObject(schema)) return schema
  const result = { ...schema }
  delete result.default
  for (const key of ["properties", "patternProperties", "definitions", "$defs", "dependentSchemas"]) {
    if (isObject(result[key])) {
      result[key] = Object.fromEntries(Object.entries(result[key]).map(
        ([name, child]) => [name, withoutFormDefaults(child)],
      ))
    }
  }
  for (const key of ["additionalItems", "not", "if", "then", "else"]) {
    if (isObject(result[key])) result[key] = withoutFormDefaults(result[key])
  }
  for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"]) {
    if (Array.isArray(result[key])) result[key] = result[key].map(withoutFormDefaults)
  }
  return result
}

export const creationFormStateBehavior: Experimental_DefaultFormStateBehavior = {
  emptyObjectFields: "skipDefaults",
  arrayMinItems: { populate: "never" },
  constAsDefaults: "never",
}

export function preserveEmptyStrings(schema: RJSFSchema, ui: UiSchema = {}): UiSchema {
  const result = { ...ui }
  if (schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string"))) {
    result["ui:emptyValue"] = ""
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (isObject(child)) result[key] = preserveEmptyStrings(child as RJSFSchema, result[key])
  }
  for (const key of ["items", "additionalProperties"] as const) {
    if (isObject(schema[key])) result[key] = preserveEmptyStrings(schema[key] as RJSFSchema, result[key])
  }
  return result
}
