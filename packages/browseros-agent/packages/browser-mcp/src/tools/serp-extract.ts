import type { ToolContext } from './framework'
import { wrapUntrusted } from './trust-boundary'

interface OrganicResult {
  title: string
  url: string
  snippet: string
}

interface PaginationLink {
  text: string
  url: string
}

interface ExtractedSerp {
  query: string
  results: OrganicResult[]
  paa: string[]
  pagination: PaginationLink[]
}

const SERP_EVAL_TIMEOUT_MS = 10_000

export function isGoogleSerp(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname !== 'www.google.com' &&
      parsed.hostname !== 'google.com'
    ) {
      return false
    }
    return parsed.pathname === '/search'
  } catch {
    return false
  }
}

export async function extractGoogleSerp(
  ctx: ToolContext,
  pageId: number,
): Promise<string | null> {
  try {
    const { session } = await ctx.session.pages.getSession(pageId)
    const result = await session.Runtime.evaluate({
      expression: wrapAsAsyncIife(SERP_SCRIPT),
      returnByValue: true,
      awaitPromise: true,
      timeout: SERP_EVAL_TIMEOUT_MS,
    })

    if (result.exceptionDetails) return null
    const value = result.result?.value
    if (!value || typeof value !== 'object') return null
    return formatSerp(value as ExtractedSerp)
  } catch {
    return null
  }
}

function formatSerp(data: ExtractedSerp): string | null {
  const query = (data.query ?? '').trim()
  const results = Array.isArray(data.results) ? data.results : []
  const paa = Array.isArray(data.paa) ? data.paa : []
  const pagination = Array.isArray(data.pagination) ? data.pagination : []

  if (!query && results.length === 0 && paa.length === 0) return null

  const sections: string[] = []

  if (query) sections.push(`Google Search: "${query}"`)

  if (results.length > 0) {
    const lines: string[] = ['Results:']
    results.forEach((r, i) => {
      const title = (r.title ?? '').trim()
      const url = (r.url ?? '').trim()
      const snippet = (r.snippet ?? '').trim()
      if (!title && !url && !snippet) return
      lines.push(`${i + 1}. ${title || '(untitled)'}`)
      if (url) lines.push(`   ${url}`)
      if (snippet) lines.push(`   ${snippet}`)
    })
    if (lines.length > 1) sections.push(lines.join('\n'))
  }

  if (paa.length > 0) {
    sections.push(['People also ask:', ...paa.map((q) => `- ${q}`)].join('\n'))
  }

  if (pagination.length > 0) {
    const links = pagination
      .map((p) => `- ${p.text}: ${p.url}`)
      .filter((line) => !line.endsWith(': '))
    if (links.length > 0) sections.push(['Pagination:', ...links].join('\n'))
  }

  if (sections.length === 0) return null
  return wrapUntrusted(sections.join('\n\n'), 'google-search')
}

function wrapAsAsyncIife(code: string): string {
  return `(async () => {\n${code}\n})()`
}

const SERP_SCRIPT = `
const query = (document.querySelector('input[name="q"]')?.value || '').trim();

const results = Array.from(document.querySelectorAll('.g')).slice(0, 10).map((block) => {
  const titleEl = block.querySelector('h3');
  const linkEl = block.closest('a[href]') || block.querySelector('a[href]');
  const snippetEl = block.querySelector('.VwiC3b') || block.querySelector('.lyLwlc');
  return {
    title: (titleEl?.textContent || '').trim(),
    url: (linkEl?.href || '').trim(),
    snippet: (snippetEl?.textContent || '').trim(),
  };
}).filter((r) => r.title || r.url || r.snippet);

const paa = Array.from(
  document.querySelectorAll('[data-q], .related-question-pair'),
)
  .map((el) => (el.textContent || '').trim())
  .filter((text, idx, arr) => text.length > 0 && arr.indexOf(text) === idx)
  .slice(0, 6);

const pagination = Array.from(
  document.querySelectorAll('#botstuff a, #footcnt a'),
)
  .map((a) => ({
    text: (a.textContent || '').trim(),
    url: (a.href || '').trim(),
  }))
  .filter((p) => p.text && p.url)
  .slice(0, 8);

return { query, results, paa, pagination };
`
