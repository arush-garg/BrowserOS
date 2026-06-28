export interface StructuredElement {
  backendNodeId: number
  tag?: string
  text?: string
  label?: string
  role?: string
  attributes?: Record<string, string>
  rect?: { x: number; y: number }
}

// Rough token estimate: average 4 chars per token
export function estimateTokens(text?: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export function scoreElement(el: StructuredElement): number {
  let score = 0
  if (el.text && el.text.length > 0) score += Math.min(1000, el.text.length)
  if (el.label && el.label.length > 0) score += Math.min(500, el.label.length)
  const roleBoost: Record<string, number> = {
    button: 200,
    link: 150,
    heading: 300,
    textbox: 250,
    img: 100,
  }
  if (el.role && roleBoost[el.role])
    score += roleBoost[el.role as keyof typeof roleBoost]
  if (el.attributes) {
    if (el.attributes['aria-hidden'] === 'true') score -= 1000
    if (el.attributes['data-important']) score += 200
  }
  // small boost for having rect (likely visible)
  if (el.rect) score += 50
  return score
}

export function pruneElements(
  candidates: StructuredElement[],
  maxElements: number,
): StructuredElement[] {
  if (candidates.length <= maxElements) return candidates
  const scored = candidates.map((c) => ({ c, s: scoreElement(c) }))
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, maxElements).map((x) => x.c)
}

export default { estimateTokens, scoreElement, pruneElements }
