import { estimateTextTokens } from './token-estimate'

/**
 * Picks the most useful lines of an accessibility snapshot to fit a budget.
 *
 * A plain prefix cut is the wrong shape for a snapshot: the truncated tail is where the
 * primary actions usually live (submit buttons, pagination, dialogs appended to <body>),
 * while the surviving head is mostly chrome. This ranks each node instead and keeps the
 * parents of whatever it keeps, so the result is still a readable tree with live refs.
 */

// Words too common to say anything about which node a goal is about.
const STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'this',
  'that',
  'then',
  'page',
  'click',
  'open',
  'find',
  'get',
  'set',
  'use',
  'via',
  'any',
  'all',
  'please',
  'should',
  'would',
  'could',
  'need',
  'want',
  'make',
  'you',
  'your',
])

const MIN_TERM_LENGTH = 3
// Below this a clamped line carries nothing useful, so the leftover budget is left unused.
const MIN_CLAMP_CHARS = 80
// Elision markers are emitted after selection, so content is held below the full budget.
const MARKER_BUDGET_FRACTION = 0.9

const SCORE = {
  goalTerm: 10,
  interactive: 6,
  heading: 4,
  cursorPointer: 1,
  named: 2,
  stateful: 2,
  disabled: -3,
  perDepth: -0.25,
} as const

export interface RelevanceOptions {
  /** Maximum characters of snapshot text to return, markers included. */
  budgetChars: number
  /** The user goal, when there is one — its terms dominate the ranking. */
  goal?: string
}

export interface RelevanceResult {
  text: string
  keptLines: number
  totalLines: number
  elidedLines: number
  /** False when the snapshot already fit and nothing was dropped. */
  trimmed: boolean
}

interface ClampedLine {
  index: number
  text: string
}

interface SnapshotLine {
  index: number
  depth: number
  score: number
  cost: number
  text: string
}

export function selectRelevantLines(
  text: string,
  options: RelevanceOptions,
): RelevanceResult {
  const lines = text.split('\n')
  if (text.length <= options.budgetChars) {
    return {
      text,
      keptLines: lines.length,
      totalLines: lines.length,
      elidedLines: 0,
      trimmed: false,
    }
  }

  const terms = goalTerms(options.goal)
  const parsed = lines.map((line, index) => parseLine(line, index, terms))
  const markerReserve =
    lines.length > 1
      ? Math.floor(options.budgetChars * MARKER_BUDGET_FRACTION)
      : options.budgetChars
  const { kept, clamp } = selectWithinBudget(parsed, markerReserve)

  // A clamped line counts as kept: it is present in the output, just shortened.
  const keptLines = kept.size + (clamp ? 1 : 0)
  return {
    text: render(lines, kept, clamp),
    keptLines,
    totalLines: lines.length,
    elidedLines: lines.length - keptLines,
    trimmed: true,
  }
}

/** Same selection, sized by the chars/3 token estimate the snapshot tools budget in. */
export function selectRelevantByTokens(
  text: string,
  options: { budgetTokens: number; goal?: string },
): RelevanceResult {
  if (estimateTextTokens(text) <= options.budgetTokens) {
    const lines = text.split('\n')
    return {
      text,
      keptLines: lines.length,
      totalLines: lines.length,
      elidedLines: 0,
      trimmed: false,
    }
  }
  return selectRelevantLines(text, {
    budgetChars: options.budgetTokens * 3,
    goal: options.goal,
  })
}

export function goalTerms(goal: string | undefined): string[] {
  if (!goal) return []
  const seen = new Set<string>()
  for (const raw of goal.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TERM_LENGTH || STOPWORDS.has(raw)) continue
    seen.add(raw)
  }
  return [...seen]
}

function parseLine(
  line: string,
  index: number,
  terms: readonly string[],
): SnapshotLine {
  const depth = indentDepth(line)
  const lower = line.toLowerCase()
  const role = line.trim().replace(/^-\s*/, '').split(/[\s[]/, 1)[0] ?? ''

  let score = depth * SCORE.perDepth
  for (const term of terms) if (lower.includes(term)) score += SCORE.goalTerm
  if (line.includes('[ref=')) score += SCORE.interactive
  if (line.includes('[cursor=pointer]')) score += SCORE.cursorPointer
  if (line.includes('"')) score += SCORE.named
  if (/\[(checked|selected|expanded|required)]/.test(line))
    score += SCORE.stateful
  if (line.includes('[disabled]')) score += SCORE.disabled
  if (role.startsWith('heading') || role === 'iframe') score += SCORE.heading

  return { index, depth, score, cost: line.length + 1, text: line }
}

function indentDepth(line: string): number {
  const match = /^ */.exec(line)
  return Math.floor((match?.[0].length ?? 0) / 2)
}

/**
 * Greedy by score, ancestors included.
 *
 * A node is only actionable in context — "button" under an unnamed div says nothing — so
 * taking a line also takes its parent chain, and the whole chain is charged before the line
 * is accepted. That keeps the output a valid tree rather than a list of orphans.
 */
function selectWithinBudget(
  lines: readonly SnapshotLine[],
  budget: number,
): { kept: Set<number>; clamp?: ClampedLine } {
  const ranked = [...lines].sort(
    (a, b) => b.score - a.score || a.index - b.index,
  )
  const kept = new Set<number>()
  let used = 0

  for (const line of ranked) {
    const chain = ancestorChain(lines, line).filter((l) => !kept.has(l.index))
    const cost = chain.reduce((sum, l) => sum + l.cost, 0)
    if (used + cost > budget) continue
    for (const node of chain) kept.add(node.index)
    used += cost
  }

  return { kept, clamp: clampBestRemaining(ranked, kept, budget - used) }
}

/**
 * Spends whatever budget the whole-line pass could not use on a clamped line.
 *
 * Without this a page whose one interesting node is a huge text value (or a snapshot that is
 * a single unbroken line) returns almost nothing: every candidate costs more than the budget,
 * so the greedy pass skips them all and the model is told the page is empty.
 */
function clampBestRemaining(
  ranked: readonly SnapshotLine[],
  kept: ReadonlySet<number>,
  remaining: number,
): ClampedLine | undefined {
  if (remaining < MIN_CLAMP_CHARS) return undefined
  const candidate = ranked.find((line) => !kept.has(line.index))
  if (!candidate) return undefined
  return { index: candidate.index, text: clampLine(candidate.text, remaining) }
}

// Refs live at the end of a line, so a plain head slice would drop the one thing that makes
// the node actionable. Keep it when it fits.
function clampLine(line: string, max: number): string {
  if (line.length <= max) return line
  const ref = /\s(\[ref=e\d+])$/.exec(line)?.[1] ?? ''
  const head = Math.max(0, max - 1 - (ref ? ref.length + 1 : 0))
  return ref ? `${line.slice(0, head)}… ${ref}` : `${line.slice(0, max - 1)}…`
}

function ancestorChain(
  lines: readonly SnapshotLine[],
  line: SnapshotLine,
): SnapshotLine[] {
  const chain = [line]
  let depth = line.depth
  for (let i = line.index - 1; i >= 0 && depth > 0; i--) {
    const candidate = lines[i]
    if (candidate && candidate.depth < depth) {
      chain.unshift(candidate)
      depth = candidate.depth
    }
  }
  return chain
}

// The marker is explicit on purpose: a silently pruned tree would read as a complete page,
// and the model would conclude a missing control does not exist.
function render(
  lines: readonly string[],
  kept: ReadonlySet<number>,
  clamp?: ClampedLine,
): string {
  const out: string[] = []
  let gap = 0

  const flush = (indent: string): void => {
    if (gap === 0) return
    out.push(`${indent}… ${gap} node${gap === 1 ? '' : 's'} elided`)
    gap = 0
  }

  for (const [index, line] of lines.entries()) {
    if (!kept.has(index) && index !== clamp?.index) {
      gap++
      continue
    }
    flush(/^ */.exec(line)?.[0] ?? '')
    out.push(index === clamp?.index ? clamp.text : line)
  }
  flush('')
  return out.join('\n')
}
