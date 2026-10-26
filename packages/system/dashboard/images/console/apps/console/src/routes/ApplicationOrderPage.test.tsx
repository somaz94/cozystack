import { forwardRef, useImperativeHandle } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import yaml from "js-yaml"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"

// The Deploy button bypasses RJSF; in form mode the gate calls
// SchemaForm.validate(), in YAML mode it is skipped. Mock SchemaForm so the
// test drives that boolean directly, and YamlEditor so Monaco stays out.
const h = vi.hoisted(() => ({
  validateReturn: true,
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  defaults: { data: {} as Record<string, Record<string, unknown>>, isLoading: false, error: null as Error | null },
  ad: {
    spec: {
      application: {
        kind: "VirtualMachine",
        plural: "virtualmachines",
        singular: "virtualmachine",
        openAPISchema: JSON.stringify({ type: "object", properties: {} }),
      },
      dashboard: {},
    },
  },
}))

vi.mock("../lib/tenant-context.tsx", () => ({
  useTenantContext: () => ({ tenantNamespace: "tenant-test" }),
}))
vi.mock("../hooks/use-application-defaults.ts", () => ({
  useApplicationDefaults: () => h.defaults,
}))
vi.mock("../lib/app-definitions.ts", () => ({
  useApplicationDefinition: () => ({ data: h.ad, isLoading: false, error: null }),
  appDisplayName: () => "Virtual Machine",
  iconDataUrl: () => null,
}))
vi.mock("@cozystack/k8s-client", () => ({
  useK8sCreate: () => ({ mutateAsync: h.createMutateAsync, isPending: false }),
  useK8sUpdate: () => ({ mutateAsync: h.updateMutateAsync, isPending: false }),
  K8sApiError: class K8sApiError extends Error {},
}))
vi.mock("../components/SchemaForm.tsx", () => ({
  SchemaForm: forwardRef<{ validate: () => boolean }, Record<string, unknown>>(
    function MockSchemaForm(props, ref) {
      useImperativeHandle(ref, () => ({ validate: () => h.validateReturn }))
      return <textarea aria-label="Spec" value={JSON.stringify(props.formData)} onChange={(e) => (props.onChange as (value: unknown) => void)(JSON.parse(e.target.value))} />
    },
  ),
}))
vi.mock("../components/YamlEditor.tsx", () => ({
  YamlEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea data-testid="yaml" value={value} onChange={(e) => onChange(e.target.value)} />,
}))

const { ApplicationOrderPage } = await import("./ApplicationOrderPage.tsx")

function renderPage() {
  return render(
    <MemoryRouter>
      <ApplicationOrderPage appNameOverride="virtualmachine" />
    </MemoryRouter>,
  )
}

describe("ApplicationOrderPage submit validation gate", () => {
  beforeEach(() => {
    h.createMutateAsync.mockReset()
    h.createMutateAsync.mockResolvedValue({})
    h.updateMutateAsync.mockReset()
    h.updateMutateAsync.mockResolvedValue({})
    h.validateReturn = true
    h.defaults = { data: {}, isLoading: false, error: null }
    h.ad.spec.application.kind = "VirtualMachine"
    h.ad.spec.application.plural = "virtualmachines"
  })

  it("does not POST in form mode when the form fails RJSF validation", async () => {
    h.validateReturn = false
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText("virtualmachine"), "demo-vm")
    await user.click(screen.getByRole("button", { name: /^deploy$/i }))

    expect(h.createMutateAsync).not.toHaveBeenCalled()
  })

  it("POSTs in form mode when the form passes validation", async () => {
    h.validateReturn = true
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText("virtualmachine"), "demo-vm")
    await user.click(screen.getByRole("button", { name: /^deploy$/i }))

    expect(h.createMutateAsync).toHaveBeenCalledTimes(1)
  })

  it("skips the gate in YAML mode even when validation would fail", async () => {
    // In YAML mode the spec is hand-authored, so the gate must not block it.
    h.validateReturn = false
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText("virtualmachine"), "demo-vm")
    await user.click(screen.getByRole("button", { name: /yaml/i }))
    await user.click(screen.getByRole("button", { name: /^deploy$/i }))

    expect(h.createMutateAsync).toHaveBeenCalledTimes(1)
  })

  it("previews installation defaults before submitting and preserves them in YAML", async () => {
    h.defaults.data = { virtualmachines: { size: "installation", nested: { enabled: false } } }
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByLabelText("Spec")).toHaveValue(JSON.stringify(h.defaults.data.virtualmachines))
    await user.type(screen.getByPlaceholderText("virtualmachine"), "demo")
    await user.click(screen.getByRole("button", { name: /yaml/i }))
    expect((screen.getByTestId("yaml") as HTMLTextAreaElement).value).toContain("size: installation")
    await user.click(screen.getByRole("button", { name: /^deploy$/i }))
    expect(h.createMutateAsync.mock.calls[0][0].spec).toEqual(h.defaults.data.virtualmachines)
  })

  it("blocks creation while defaults load or cannot be read", () => {
    h.defaults.isLoading = true
    const view = renderPage()
    expect(screen.queryByRole("button", { name: /^deploy$/i })).not.toBeInTheDocument()
    h.defaults = { data: {}, isLoading: false, error: new Error("Forbidden") }
    view.rerender(<MemoryRouter><ApplicationOrderPage appNameOverride="virtualmachine" /></MemoryRouter>)
    expect(screen.getByText(/unable to load application defaults/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^deploy$/i })).not.toBeInTheDocument()
  })

  it("keeps user values when defaults refresh", async () => {
    h.defaults.data = { virtualmachines: { size: "first" } }
    const view = renderPage()
    fireEvent.change(screen.getByLabelText("Spec"), { target: { value: '{"size":"user","nested":{}}' } })
    h.defaults = { data: { virtualmachines: { size: "second", nested: { added: true }, extra: 2 } }, isLoading: false, error: null }
    view.rerender(<MemoryRouter><ApplicationOrderPage appNameOverride="virtualmachine" /></MemoryRouter>)
    expect(JSON.parse((screen.getByLabelText("Spec") as HTMLTextAreaElement).value)).toEqual({ size: "user", nested: {}, extra: 2 })
  })

  it("uses saved spec in edit mode without installation defaults", () => {
    h.defaults = { data: { virtualmachines: { size: "new", added: true } }, isLoading: true, error: new Error("Forbidden") }
    render(<MemoryRouter><ApplicationOrderPage appNameOverride="virtualmachine" editMode={{ name: "existing", initialSpec: { size: "saved" } }} /></MemoryRouter>)
    expect(screen.getByLabelText("Spec")).toHaveValue('{"size":"saved"}')
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled()
  })

  it("preserves explicit empty values across a form/YAML round trip", async () => {
    h.defaults.data = { virtualmachines: { nested: { value: "install" }, size: "install" } }
    const user = userEvent.setup()
    renderPage()
    const spec = { nested: {}, size: "", list: [], flag: false, count: 0, nullable: null }
    fireEvent.change(screen.getByLabelText("Spec"), { target: { value: JSON.stringify(spec) } })
    await user.type(screen.getByPlaceholderText("virtualmachine"), "demo")
    await user.click(screen.getByRole("button", { name: /^yaml$/i }))
    await user.click(screen.getByRole("button", { name: /^form$/i }))
    expect(JSON.parse((screen.getByLabelText("Spec") as HTMLTextAreaElement).value)).toEqual(spec)
    await user.click(screen.getByRole("button", { name: /^deploy$/i }))
    expect(h.createMutateAsync.mock.calls[0][0].spec).toEqual(spec)
  })

  it("preserves YAML edits when defaults refresh", async () => {
    h.defaults.data = { virtualmachines: { size: "first" } }
    const user = userEvent.setup()
    const view = renderPage()
    await user.click(screen.getByRole("button", { name: /^yaml$/i }))
    fireEvent.change(screen.getByTestId("yaml"), { target: { value: 'metadata:\n  name: demo\nspec:\n  size: user\n  nested: {}\n' } })
    h.defaults = { data: { virtualmachines: { size: "second", nested: { added: true }, extra: 2 } }, isLoading: false, error: null }
    view.rerender(<MemoryRouter><ApplicationOrderPage appNameOverride="virtualmachine" /></MemoryRouter>)
    expect(yaml.load((screen.getByTestId("yaml") as HTMLTextAreaElement).value)).toMatchObject({
      metadata: { name: "demo" }, spec: { size: "user", nested: {}, extra: 2 },
    })
  })

  it("leaves invalid YAML editable when configuration refreshes", async () => {
    const user = userEvent.setup()
    const view = renderPage()
    await user.click(screen.getByRole("button", { name: /^yaml$/i }))
    fireEvent.change(screen.getByTestId("yaml"), { target: { value: "spec: [" } })
    h.defaults = { data: { virtualmachines: { size: "new" } }, isLoading: false, error: null }
    view.rerender(<MemoryRouter><ApplicationOrderPage appNameOverride="virtualmachine" /></MemoryRouter>)
    expect(screen.getByTestId("yaml")).toHaveValue("spec: [")
    await user.click(screen.getByRole("button", { name: /^deploy$/i }))
    expect(h.createMutateAsync).not.toHaveBeenCalled()
  })

  it("selects another application's defaults by plural without carrying over the previous spec", () => {
    h.defaults.data = { virtualmachines: { size: "first" }, otherwidgets: { option: "other" } }
    const view = renderPage()
    expect(screen.getByLabelText("Spec")).toHaveValue('{"size":"first"}')
    h.ad.spec.application.kind = "ArbitraryApplication"
    h.ad.spec.application.plural = "otherwidgets"
    view.rerender(<MemoryRouter><ApplicationOrderPage appNameOverride="otherwidget" /></MemoryRouter>)
    expect(screen.getByLabelText("Spec")).toHaveValue('{"option":"other"}')
  })
})
