import type { AcpAgentType } from '@browseros/shared/schemas/agent'
import { useQuery } from '@tanstack/react-query'
import type { ProviderType } from '@/lib/llm-providers/types'
// Relative value import: `bun test` resolves tsconfig `@/` paths only for
// erased `import type`; a `@/` value import fails to load under bun test.
import { useAgentServerUrl } from '../browseros/agent-server-url.hooks'

interface AcpProbeModel {
  id: string
  name?: string
  description?: string
}

interface AcpProbeReasoning {
  values: string[]
  defaultValue?: string
}

interface AcpProbeError {
  code: string
  message: string
}

interface AcpProbeResult {
  models: AcpProbeModel[]
  reasoning: AcpProbeReasoning | null
  supportsConfigOption: boolean
  agentInfo: { name?: string; title?: string; version?: string } | null
  protocolVersion: number
  error?: AcpProbeError
}

export interface UseAcpProbeOptions {
  providerType: ProviderType | undefined
  /** Overrides the ACP type derived from `providerType`. */
  acpAgentType?: AcpAgentType
  command?: string
  cwd?: string
  enabled?: boolean
}

// The probe endpoint addresses an agent by ACP type, not by a saved agent id
// (see POST /acpx/probe). `custom` is probed by its command instead.
const ACP_TYPE_BY_PROVIDER: Partial<Record<ProviderType, AcpAgentType>> = {
  'claude-code': 'claude',
  codex: 'codex',
  'acp-custom': 'custom',
}

// Probe results encode the agent's currently-installed CLI version, which
// can change underfoot (npm install, codex-acp release). Refetch on every
// dialog open instead of trusting a stale memory cache.
const PROBE_STALE_TIME_MS = 0

export function resolveAcpAgentType(
  opts: UseAcpProbeOptions,
): AcpAgentType | undefined {
  if (opts.acpAgentType) return opts.acpAgentType
  if (!opts.providerType) return undefined
  return ACP_TYPE_BY_PROVIDER[opts.providerType]
}

export function isAcpProbeEnabled(
  opts: UseAcpProbeOptions,
  agentServerUrl: string | undefined,
  agentType: AcpAgentType | undefined,
): boolean {
  if (!(opts.enabled ?? true)) return false
  if (!agentServerUrl) return false
  if (!agentType) return false
  // A custom agent has no saved config yet, so it can only be probed by its
  // command line.
  if (agentType === 'custom') return Boolean(opts.command)
  return true
}

export function useAcpProbe(opts: UseAcpProbeOptions) {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const agentType = resolveAcpAgentType(opts)
  const enabled = isAcpProbeEnabled(
    opts,
    agentServerUrl ?? undefined,
    agentType,
  )

  return useQuery<AcpProbeResult>({
    queryKey: ['acpx-probe', agentType, opts.command, opts.cwd],
    enabled,
    staleTime: PROBE_STALE_TIME_MS,
    queryFn: async () => {
      const res = await fetch(`${agentServerUrl}/acpx/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: agentType,
          ...(opts.command ? { command: opts.command } : {}),
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: AcpProbeError
        }
        throw new Error(body.error?.message ?? 'Probe request failed')
      }
      return (await res.json()) as AcpProbeResult
    },
  })
}
