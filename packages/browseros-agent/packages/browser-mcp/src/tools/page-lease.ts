const leases = new Map<number, { owner: string; acquiredAt: number }>()

export function acquirePageLease(
  page: number,
  owner: string,
): { ok: boolean; owner: string } {
  const existing = leases.get(page)
  if (existing && existing.owner !== owner)
    return { ok: false, owner: existing.owner }
  leases.set(page, { owner, acquiredAt: Date.now() })
  return { ok: true, owner }
}

export function releasePageLease(page: number, owner: string): boolean {
  const existing = leases.get(page)
  if (!existing || existing.owner !== owner) return false
  leases.delete(page)
  return true
}

export function getPageLease(page: number) {
  return leases.get(page)
}

export function assertPageLease(
  page: number,
  owner?: string,
): string | undefined {
  const lease = leases.get(page)
  if (!lease || lease.owner === owner) return undefined
  return `page ${page} is leased by ${lease.owner}`
}
