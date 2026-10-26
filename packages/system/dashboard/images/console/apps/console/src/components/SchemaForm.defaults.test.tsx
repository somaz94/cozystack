import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SchemaForm } from "./SchemaForm.tsx"
import { prepareCreationSpec } from "../lib/application-defaults.ts"

const schema = JSON.stringify({
  type: "object",
  properties: {
    name: { type: "string", default: "developer" },
    nested: { type: "object", default: {}, properties: { value: { type: "string", default: "developer-nested" } } },
    list: { type: "array", minItems: 1, items: { type: "string", default: "developer-item" } },
  },
})

function Harness({ empty = false }: { empty?: boolean }) {
  const [spec, setSpec] = useState<unknown>(() => prepareCreationSpec(schema, {}, {
    name: "installation", nested: empty ? {} : { value: "installation-nested" }, list: [],
  }))
  return <>
    <SchemaForm openAPISchema={schema} formData={spec} onChange={setSpec} defaulting="external" />
    <output data-testid="spec">{JSON.stringify(spec)}</output>
  </>
}

describe("RJSF externally prepared defaults", () => {
  it("shows installation values and submits edits without refilling empty arrays", () => {
    render(<Harness />)
    expect(screen.getByLabelText("name")).toHaveValue("installation")
    expect(screen.getByLabelText("value")).toHaveValue("installation-nested")
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "user" } })
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({
      name: "user", nested: { value: "installation-nested" }, list: [],
    })
  })

  it("does not show or emit nested developer values inside an empty object", () => {
    render(<Harness empty />)
    expect(screen.getByLabelText("value")).toHaveValue("")
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "user" } })
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({
      name: "user", nested: {}, list: [],
    })
  })

  it("preserves an explicitly cleared string instead of omitting it", () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "" } })
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "").name).toBe("")
  })

  it("preserves empty strings and objects in the nested map editor", () => {
    const mapSchema = JSON.stringify({
      type: "object",
      properties: {
        entries: { type: "object", additionalProperties: {
          type: "object", properties: { setting: { type: "string", default: "developer" } },
        } },
      },
    })
    function MapHarness() {
      const [spec, setSpec] = useState<unknown>({ entries: { configured: { setting: "installation" }, empty: {} } })
      return <>
        <SchemaForm openAPISchema={mapSchema} formData={spec} onChange={setSpec} defaulting="external" />
        <output data-testid="spec">{JSON.stringify(spec)}</output>
      </>
    }
    render(<MapHarness />)
    const inputs = screen.getAllByLabelText("setting")
    expect(inputs[0]).toHaveValue("installation")
    expect(inputs[1]).toHaveValue("")
    fireEvent.change(inputs[0], { target: { value: "" } })
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({
      entries: { configured: { setting: "" }, empty: {} },
    })
  })

  it("applies developer defaults to a new array row without installation defaults", () => {
    const rowSchema = JSON.stringify({
      type: "object",
      properties: { rows: { type: "array", items: {
        type: "object", required: ["mode"], properties: { mode: { type: "string", default: "safe" } },
      } } },
    })
    function RowsHarness() {
      const [spec, setSpec] = useState<unknown>(() => prepareCreationSpec(rowSchema, {}, {}))
      return <>
        <SchemaForm openAPISchema={rowSchema} formData={spec} onChange={setSpec} defaulting="external" />
        <output data-testid="spec">{JSON.stringify(spec)}</output>
      </>
    }
    render(<RowsHarness />)
    fireEvent.click(screen.getByRole("button", { name: /add/i }))
    expect(screen.getByLabelText(/^mode/)).toHaveValue("safe")
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({ rows: [{ mode: "safe" }] })
  })

  it.each([true, false])("initializes a new dictionary entry with object schema %s", (object) => {
    const mapSchema = JSON.stringify({
      type: "object",
      properties: { entries: { type: "object", additionalProperties: object
        ? { type: "object", required: ["mode"], properties: { mode: { type: "string", default: "safe" } } }
        : { type: "string" },
      } },
    })
    function MapHarness() {
      const [spec, setSpec] = useState<unknown>({ entries: {} })
      return <>
        <SchemaForm openAPISchema={mapSchema} formData={spec} onChange={setSpec} defaulting="external" />
        <output data-testid="spec">{JSON.stringify(spec)}</output>
      </>
    }
    render(<MapHarness />)
    fireEvent.change(screen.getByPlaceholderText("Enter key name..."), { target: { value: "new" } })
    fireEvent.click(screen.getByRole("button", { name: /add/i }))
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({
      entries: { new: object ? { mode: "safe" } : "" },
    })
  })

  it("initializes a new array row in a dictionary entry", () => {
    const mapSchema = JSON.stringify({
      type: "object",
      properties: { entries: { type: "object", additionalProperties: {
        type: "object", properties: { rows: { type: "array", items: {
          type: "object", required: ["mode"], properties: { mode: { type: "string", default: "safe" } },
        } } },
      } } },
    })
    function MapHarness() {
      const [spec, setSpec] = useState<unknown>({ entries: { existing: { rows: [] } } })
      return <>
        <SchemaForm openAPISchema={mapSchema} formData={spec} onChange={setSpec} defaulting="external" />
        <output data-testid="spec">{JSON.stringify(spec)}</output>
      </>
    }
    render(<MapHarness />)
    const fieldset = screen.getByText("rows").closest("fieldset")
    expect(fieldset).not.toBeNull()
    fireEvent.click(within(fieldset!).getByRole("button", { name: /add/i }))
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({
      entries: { existing: { rows: [{ mode: "safe" }] } },
    })
  })

  it("does not reapply defaults to an existing row's empty object", () => {
    const rowSchema = JSON.stringify({
      type: "object", properties: { rows: { type: "array", items: {
        type: "object", properties: {
          mode: { type: "string", default: "safe" },
          nested: { type: "object", default: {}, properties: { value: { type: "string", default: "developer" } } },
        },
      } } },
    })
    function RowsHarness() {
      const [spec, setSpec] = useState<unknown>({ rows: [{ mode: "user", nested: {} }] })
      return <>
        <SchemaForm openAPISchema={rowSchema} formData={spec} onChange={setSpec} defaulting="external" />
        <output data-testid="spec">{JSON.stringify(spec)}</output>
      </>
    }
    render(<RowsHarness />)
    fireEvent.change(screen.getByLabelText("mode"), { target: { value: "edited" } })
    expect(JSON.parse(screen.getByTestId("spec").textContent ?? "")).toEqual({
      rows: [{ mode: "edited", nested: {} }],
    })
  })
})
