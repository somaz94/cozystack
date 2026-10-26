import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { K8sApiError, useK8sGet } from "@cozystack/k8s-client"
import { useApplicationDefaults } from "./use-application-defaults.ts"

const h = vi.hoisted(() => ({
  query: {
    data: undefined as { data?: Record<string, string> } | undefined,
    error: null as Error | null,
    isLoading: false,
  },
}))
vi.mock("@cozystack/k8s-client", async (original) => ({
  ...await original<typeof import("@cozystack/k8s-client")>(),
  useK8sGet: vi.fn(() => h.query),
}))

describe("installation defaults ConfigMap", () => {
  beforeEach(() => {
    h.query = { data: undefined, error: null, isLoading: false }
  })

  it("gets only the named ConfigMap through the existing Kubernetes API", () => {
    h.query.data = { data: { "defaults.json": '{"widgets":{"size":"small"}}' } }
    const { result } = renderHook(() => useApplicationDefaults(true))
    expect(result.current.data).toEqual({ widgets: { size: "small" } })
    expect(useK8sGet).toHaveBeenLastCalledWith({
      apiGroup: "", apiVersion: "v1", plural: "configmaps",
      namespace: "cozy-system", name: "cozystack-application-defaults",
    }, { enabled: true, retry: false })
  })

  it("treats a missing ConfigMap as empty, even after a cached result", () => {
    h.query = { data: { data: { "defaults.json": '{"widgets":{"size":"old"}}' } }, error: new K8sApiError(404, "Not found"), isLoading: false }
    const { result } = renderHook(() => useApplicationDefaults(true))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBeNull()
  })

  it("surfaces access, JSON and structure errors", () => {
    h.query.error = new K8sApiError(403, "Forbidden")
    const { result, rerender } = renderHook(() => useApplicationDefaults(true))
    expect(result.current.error?.message).toBe("Forbidden")
    for (const raw of ["", "{", "null", '{"widgets":[]}']) {
      h.query = { data: { data: { "defaults.json": raw } }, error: null, isLoading: false }
      rerender()
      expect(result.current.error).not.toBeNull()
    }
  })

  it("does not enable the query for an existing application", () => {
    h.query.error = new K8sApiError(403, "Forbidden")
    const { result } = renderHook(() => useApplicationDefaults(false))
    expect(result.current).toEqual({ data: {}, error: null, isLoading: false })
    expect(useK8sGet).toHaveBeenLastCalledWith(expect.anything(), { enabled: false, retry: false })
  })
})
