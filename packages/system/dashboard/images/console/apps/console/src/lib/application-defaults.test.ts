import { describe, expect, it } from "vitest"
import { parseApplicationDefaults, prepareCreationSpec, withoutFormDefaults } from "./application-defaults.ts"

const schema = {
  type: "object",
  properties: {
    size: { type: "string", default: "developer" },
    nested: {
      type: "object",
      default: {},
      properties: {
        a: { type: "string", default: "developer-a" },
        b: { type: "string", default: "developer-b" },
      },
    },
    list: { type: "array", default: ["developer"], items: { type: "string" } },
    flag: { type: "boolean", default: true },
    count: { type: "integer", default: 3 },
    nullable: { type: ["string", "null"], default: "developer" },
  },
}

describe("application creation defaults", () => {
  it("combines user, installation and developer values without changing sources", () => {
    const original = JSON.stringify(schema)
    const installation = { size: "installation", nested: { a: "installation-a" } }
    const spec = { nested: { a: "user-a" } }
    expect(prepareCreationSpec(original, spec, installation)).toMatchObject({
      size: "installation", nested: { a: "user-a", b: "developer-b" },
    })
    expect(JSON.stringify(schema)).toBe(original)
    expect(installation.nested).toEqual({ a: "installation-a" })
    expect(spec).toEqual({ nested: { a: "user-a" } })
  })

  it("preserves empty objects, arrays, false, zero, strings and null", () => {
    const spec = { size: "", nested: {}, list: [], flag: false, count: 0, nullable: null }
    const installation = { size: "installation", nested: { a: "installation-a" }, list: ["install"], flag: true, count: 9, nullable: "install" }
    expect(prepareCreationSpec(JSON.stringify(schema), spec, installation)).toEqual(spec)
  })

  it("keeps an installation's explicitly empty object empty", () => {
    expect(prepareCreationSpec(JSON.stringify(schema), {}, { nested: {} }).nested).toEqual({})
  })

  it("supports arbitrary application plurals and rejects malformed entries anywhere", () => {
    expect(parseApplicationDefaults('{"widgets":{"size":"small"},"otherwidgets":{"count":2}}')).toEqual({
      widgets: { size: "small" }, otherwidgets: { count: 2 },
    })
    expect(parseApplicationDefaults('{"widgets":{"config":{"_source":true}}}')).toEqual({ widgets: { config: { _source: true } } })
    for (const raw of ["", "{", "null", "[]", "{} {}", '{"widgets":null}', '{"otherwidgets":false}', '{"widgets":{"_cluster":{}}}']) {
      expect(() => parseApplicationDefaults(raw), raw).toThrow()
    }
  })

  it("copies schema nodes while preserving a property named default", () => {
    const original = { default: {}, properties: { default: { type: "string", default: "value" } }, additionalProperties: { default: 1 } }
    expect(withoutFormDefaults(original)).toEqual({ properties: { default: { type: "string" } }, additionalProperties: {} })
    expect(original.properties.default.default).toBe("value")
  })
})
