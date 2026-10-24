/**
 * Policy gate for the browser-MCP action surface.
 *
 * This is a gate, not a new permission system: it answers "may this tool
 * run, for this origin, on this run?" before a handler executes. It does
 * not inspect page content, does not change click execution, and does not
 * replace the MCP server's own authentication/ownership checks.
 *
 * - `excludedTools`: tools disabled for this run (e.g. no screenshots
 *   when vision is off, no evaluate on an untrusted run).
 * - `allowedOrigins`: when set, tools may only run against pages whose
 *   origin (or hostname, for a bare-host entry) is listed. An unset list
 *   means "no origin restriction from this policy".
 * An origin is never inferred from a tool argument alone by callers that
 * do not know the page URL; pass the page's known origin explicitly.
 */

export interface ActionPolicy {
  /** Tool names disabled for this run. */
  excludedTools?: string[]
  /**
   * Allowed page origins (e.g. "https://example.com") or bare hostnames
   * (e.g. "example.com"). Unset = no origin restriction.
   */
  allowedOrigins?: string[]
}

export interface PolicyDecision {
  allowed: boolean
  reason?: string
}

function originHostname(origin: string): string | undefined {
  try {
    return new URL(origin).hostname
  } catch {
    return undefined
  }
}

function originMatches(entry: string, origin: string): boolean {
  if (entry === origin) return true
  const entryHost = originHostname(entry) ?? entry
  const originHost = originHostname(origin)
  return originHost !== undefined && entryHost === originHost
}

/** Check one tool call against a policy. Pure; no browser access. */
export function checkActionPolicy(
  toolName: string,
  policy: ActionPolicy | undefined,
  origin?: string,
): PolicyDecision {
  if (!policy) return { allowed: true }
  if (policy.excludedTools?.includes(toolName)) {
    return { allowed: false, reason: `tool "${toolName}" is excluded for this run` }
  }
  if (policy.allowedOrigins !== undefined && origin !== undefined) {
    const allowed = policy.allowedOrigins.some((entry) =>
      originMatches(entry, origin),
    )
    if (!allowed) {
      return {
        allowed: false,
        reason: `origin "${origin}" is not in this run's allowed origins`,
      }
    }
  }
  return { allowed: true }
}

/**
 * Filter a tool-name list by policy. Tools with no origin knowledge are
 * kept unless excluded; origin filtering applies only when an origin is
 * supplied, so a catalog listing never silently drops tools.
 */
export function filterToolsByPolicy(
  toolNames: readonly string[],
  policy: ActionPolicy | undefined,
  origin?: string,
): string[] {
  return toolNames.filter(
    (name) => checkActionPolicy(name, policy, origin).allowed,
  )
}

/** One-line, log-safe description of a policy (no origins are secrets). */
export function describeActionPolicy(
  policy: ActionPolicy | undefined,
): string {
  if (!policy) return 'no action policy (all tools allowed)'
  const parts: string[] = []
  if (policy.excludedTools?.length)
    parts.push(`excluded tools: ${policy.excludedTools.join(', ')}`)
  if (policy.allowedOrigins !== undefined)
    parts.push(`allowed origins: ${policy.allowedOrigins.join(', ') || '(none)'}`)
  return parts.length > 0 ? parts.join('; ') : 'empty action policy'
}
