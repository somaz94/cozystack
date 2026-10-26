import { useMemo } from "react"
import { K8sApiError, useK8sGet, type K8sResource } from "@cozystack/k8s-client"
import { parseApplicationDefaults } from "../lib/application-defaults.ts"

interface DefaultsConfigMap extends K8sResource {
  data?: Record<string, string>
}

export function useApplicationDefaults(enabled: boolean) {
  const query = useK8sGet<DefaultsConfigMap>({
    apiGroup: "",
    apiVersion: "v1",
    plural: "configmaps",
    namespace: "cozy-system",
    name: "cozystack-application-defaults",
  }, { enabled, retry: false })

  return useMemo<{ data: Record<string, Record<string, unknown>>; isLoading: boolean; error: Error | null }>(() => {
    if (!enabled) return { data: {}, isLoading: false, error: null }
    if (query.error instanceof K8sApiError && query.error.status === 404) {
      return { data: {}, isLoading: false, error: null }
    }
    if (query.error && !(query.error instanceof K8sApiError && query.error.status === 404)) {
      return { data: {}, isLoading: false, error: query.error }
    }
    try {
      const data = query.data ? parseApplicationDefaults(query.data.data?.["defaults.json"] ?? "") : {}
      return { data, isLoading: query.isLoading, error: null }
    } catch (error) {
      return { data: {}, isLoading: false, error: error as Error }
    }
  }, [enabled, query.data, query.isLoading, query.error])
}
