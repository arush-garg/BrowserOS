import { buildContentMarkdownExpression } from '@browseros/browser-core/content-markdown'
import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import { writeTempToolOutputFile } from './output-file'
import { wrapUntrusted } from './trust-boundary'

function expressionFor(
  format: 'markdown' | 'text' | 'links',
  selector?: string,
  project?: Array<'text' | 'href'>,
): string {
  if (format === 'markdown') return buildContentMarkdownExpression({ selector })
  const root = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : 'document.body'
  if (format === 'text') return `((${root})?.innerText ?? '')`
  if (project?.length) {
    const fields = project
      .map((field) =>
        field === 'href' ? 'href:a.href' : "text:(a.textContent||'').trim()",
      )
      .join(',')
    return `JSON.stringify([...(${root}?.querySelectorAll('a[href]') ?? [])].map(function(a){return {${fields}}}))`
  }
  return `[...(${root}?.querySelectorAll('a[href]') ?? [])].map(function(a){return '[' + (a.textContent||'').trim() + '](' + a.href + ')'}).join('\\n')`
}

export const read = defineTool({
  name: 'read',
  description:
    'Extract page content as markdown (default), plain text, or a list of links. For reading/scraping, not acting.',
  input: z
    .object({
      page: z.number().int(),
      format: z.enum(['markdown', 'text', 'links']).default('markdown'),
      selector: z.string().optional().describe('Restrict to a CSS subtree.'),
      viewportOnly: z
        .boolean()
        .optional()
        .describe('For markdown reads, include only visible viewport content.'),
      includeLinks: z
        .boolean()
        .optional()
        .describe('For markdown reads, render links as markdown links.'),
      includeImages: z
        .boolean()
        .optional()
        .describe('For markdown reads, include image references.'),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Character offset for paginated extraction.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100_000)
        .optional()
        .describe('Maximum characters returned inline for this page.'),
      project: z
        .array(z.enum(['text', 'href']))
        .max(2)
        .optional()
        .describe('For format=links, reserved projection fields: text, href.'),
    })
    .strict(),
  annotations: { title: 'Read page content', readOnlyHint: true },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const code =
      args.format === 'markdown'
        ? buildContentMarkdownExpression({
            selector: args.selector,
            viewportOnly: args.viewportOnly,
            includeLinks: args.includeLinks,
            includeImages: args.includeImages,
          })
        : expressionFor(args.format, args.selector, args.project)
    const result = await session.Runtime.evaluate({
      expression: code,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      return errorResult(
        `read: ${
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
        }`,
      )
    }

    const text = (result.result?.value as string) ?? ''
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    const pageLimit = args.limit ?? TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS
    const pageText = text.slice(args.offset, args.offset + pageLimit)
    const nextOffset =
      args.offset + pageText.length < text.length
        ? args.offset + pageText.length
        : undefined

    if (text.length <= pageLimit && args.offset === 0) {
      return textResult(wrapUntrusted(text || '(empty)', origin), {
        page: args.page,
        format: args.format,
        contentLength: text.length,
        offset: 0,
        nextOffset,
        writtenToFile: false,
      })
    }

    const path = await writeTempToolOutputFile({
      toolName: 'read',
      extension: args.format === 'markdown' ? 'md' : 'txt',
      content: wrapUntrusted(text, origin),
    })
    const truncated = pageText
    return textResult(
      [
        wrapUntrusted(truncated || '(empty page)', origin),
        nextOffset !== undefined
          ? `Content page ${args.offset}-${args.offset + truncated.length} of ${text.length} chars. Continue with offset=${nextOffset}. Full content saved to: ${path}`
          : `Content page ${args.offset}-${args.offset + truncated.length} of ${text.length} chars. Full content saved to: ${path}`,
      ].join('\n\n'),
      {
        page: args.page,
        format: args.format,
        path,
        contentLength: text.length,
        offset: args.offset,
        returnedLength: truncated.length,
        nextOffset,
        writtenToFile: true,
      },
    )
  },
})
