"use client"

import { useEffect } from "react"
import { API_BASE_URL } from "@/lib/citation-api"

/**
 * Fire-and-forget GET to /api/warmup on mount to warm connection pools
 * (cold-start mitigation for serverless deployments).
 *
 * Errors are swallowed silently — this is an optimisation, not a feature.
 */
export default function WarmupPing() {
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/warmup`, { method: "GET", mode: "cors" }).catch(
      () => {
        /* swallow */
      },
    )
  }, [])
  return null
}
