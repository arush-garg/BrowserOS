/* biome-disable lint/complexity/noExcessiveCognitiveComplexity */
import { tool } from 'ai'
import { z } from 'zod'
import type { Browser } from '../../browser/browser'
import {
  executeWithMetrics,
  MAX_BYTES,
  MAX_LINES,
  toModelOutput,
  truncateTail,
} from '../filesystem/utils'

const TOOL_NAME = 'web_fetch'

interface SearchResult {
  title: string
  url: string
  textSnippet: string
}

function getSearchUrl(
  query: string,
  engine: 'google' | 'brave' | 'duckduckgo',
): string {
  const encoded = encodeURIComponent(query)
  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${encoded}`
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${encoded}`
    default:
      return `https://search.brave.com/search?q=${encoded}`
  }
}

/**
 * Extract search results from a search engine page using JavaScript evaluation.
 * Targets results from Google, Brave, and DuckDuckGo.
 */
function buildSearchExtractorScript(): string {
  return `
    (function() {
      const results = [];
      
      // Brave Search results (div.snippet with h2.title and a)
      document.querySelectorAll('div.snippet').forEach(snippet => {
        const titleEl = snippet.querySelector('h2.title a');
        const urlEl = snippet.querySelector('a');
        const descEl = snippet.querySelector('p.desc');
        
        if (titleEl && urlEl) {
          results.push({
            title: titleEl.textContent?.trim() || '',
            url: urlEl.href || '',
            snippet: descEl?.textContent?.trim() || ''
          });
        }
      });
      
      // Google Search results (div.g)
      if (results.length === 0) {
        document.querySelectorAll('div.g').forEach(g => {
          const titleEl = g.querySelector('h3');
          const linkEl = g.querySelector('a[href^="http"]');
          const descEl = g.querySelector('div[style*="max-width"]')?.querySelector('div');
          
          if (titleEl && linkEl && linkEl.href) {
            results.push({
              title: titleEl.textContent?.trim() || '',
              url: linkEl.href,
              snippet: descEl?.textContent?.trim() || ''
            });
          }
        });
      }
      
      // DuckDuckGo results (article)
      if (results.length === 0) {
        document.querySelectorAll('article').forEach(article => {
          const titleEl = article.querySelector('h2 a');
          const descEl = article.querySelector('[data-testid="result-snippet"]');
          
          if (titleEl && titleEl.href) {
            results.push({
              title: titleEl.textContent?.trim() || '',
              url: titleEl.href,
              snippet: descEl?.textContent?.trim() || ''
            });
          }
        });
      }
      
      return results.slice(0, 10);
    })()
  `
}

export function createWebFetchTool(browser: Browser) {
  return tool({
    description:
      'Search the web and fetch content from top results. Uses Brave, Google, or DuckDuckGo search engines to find relevant pages and returns summaries with URLs.',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      n: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe('Number of results to fetch (1-10)'),
      engine: z
        .enum(['google', 'brave', 'duckduckgo'])
        .optional()
        .default('brave')
        .describe('Search engine to use'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        try {
          const searchUrl = getSearchUrl(params.query, params.engine)

          // Open a new page for searching
          const pageId = await browser.newPage(searchUrl, { hidden: true })

          try {
            // Wait a bit for page to load
            await new Promise((r) => setTimeout(r, 2000))

            // Extract search results using JavaScript evaluation
            const extractorScript = buildSearchExtractorScript()
            const evalResult = await browser.evaluate(pageId, extractorScript)

            if (evalResult.error) {
              return {
                text: `Failed to extract search results: ${evalResult.error}`,
                isError: true,
              }
            }

            const searchResults =
              (evalResult.value as Array<{
                title: string
                url: string
                snippet: string
              }>) || []

            if (searchResults.length === 0) {
              return {
                text: `No search results found for query: "${params.query}"`,
                isError: false,
              }
            }

            // Fetch content from top N results
            const results: SearchResult[] = []
            const limit = Math.min(params.n, searchResults.length)

            for (let i = 0; i < limit; i++) {
              const result = searchResults[i]
              if (!result.url || !result.title) continue

              try {
                // Navigate to result URL
                await browser.goto(pageId, result.url)

                // Wait briefly for page to load
                await new Promise((r) => setTimeout(r, 1000))

                // Extract page content as markdown
                const content = await browser.contentAsMarkdown(pageId, {
                  viewportOnly: false,
                  includeLinks: false,
                  includeImages: false,
                })

                // Truncate content to avoid overwhelming context
                const truncated = truncateTail(
                  content,
                  Math.min(300, MAX_LINES / 2),
                  MAX_BYTES / 2,
                )
                const snippet = truncated.content
                  .split('\n')
                  .slice(0, 5)
                  .join('\n')
                  .trim()

                results.push({
                  title: result.title,
                  url: result.url,
                  textSnippet:
                    snippet || result.snippet || '(no content available)',
                })
              } catch (_err) {
                // If fetch fails for a result, include it with the search snippet
                results.push({
                  title: result.title,
                  url: result.url,
                  textSnippet: result.snippet || '(unable to fetch content)',
                })
              }
            }

            // Close the hidden page
            await browser.closePage(pageId).catch(() => {
              // Ignore close errors
            })

            if (results.length === 0) {
              return {
                text: `Failed to fetch content from search results for: "${params.query}"`,
                isError: true,
              }
            }

            // Format results for output
            const resultLines = results.map(
              (r, i) =>
                `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.textSnippet.replace(/\n/g, '\n   ')}`,
            )

            const text = `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${params.query}"\n\n${resultLines.join('\n\n')}`

            return {
              text,
              isError: false,
            }
          } finally {
            // Ensure page is closed
            await browser.closePage(pageId).catch(() => {
              // Ignore close errors
            })
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          return {
            text: `Web fetch failed: ${errorMsg}`,
            isError: true,
          }
        }
      }),
    toModelOutput,
  })
}
