import { z } from 'zod'
import {
  DETECT_GOOGLE_APP,
  EXTRACT_GOOGLE_DOCS_STRUCTURE,
  EXTRACT_GOOGLE_DOCS_TEXT,
  EXTRACT_GOOGLE_SHEETS_CONTENT,
  EXTRACT_GOOGLE_SLIDES_CONTENT,
  GET_GOOGLE_DOC_ID,
} from '../../lib/google-content-extractors'
import { defineToolWithCategory } from '../framework'

export const extract_google_app_content = defineToolWithCategory('observation')(
  {
    name: 'extract_google_app_content',
    description:
      'Extract content from a Google Docs, Sheets, or Slides page when the canvas-based editor makes normal DOM extraction impossible. Detects the app type automatically from the URL and uses multiple extraction strategies.',
    input: z.object({
      page: z.number().describe('Page ID (from list_pages)'),
      mode: z
        .enum(['auto', 'text', 'structure'])
        .default('auto')
        .describe(
          'auto: detect best extraction; text: full text content; structure: headings/sheet names/slide count',
        ),
    }),
    output: z.object({
      appType: z.enum(['docs', 'sheets', 'slides']).nullable(),
      docId: z.string().nullable(),
      title: z.string(),
      content: z.unknown(),
      method: z.string(),
    }),
    handler: async (args, ctx, response) => {
      const appTypeResult = await ctx.browser.evaluate(
        args.page,
        DETECT_GOOGLE_APP,
      )
      const appType = appTypeResult.value as string | null

      const docIdResult = await ctx.browser.evaluate(
        args.page,
        GET_GOOGLE_DOC_ID,
      )
      let docId: string | null = null
      try {
        const parsed = JSON.parse(docIdResult.value as string)
        docId = parsed.docId
      } catch {}

      let extractScript: string
      if (appType === 'docs') {
        extractScript =
          args.mode === 'structure'
            ? EXTRACT_GOOGLE_DOCS_STRUCTURE
            : EXTRACT_GOOGLE_DOCS_TEXT
      } else if (appType === 'sheets') {
        extractScript = EXTRACT_GOOGLE_SHEETS_CONTENT
      } else if (appType === 'slides') {
        extractScript = EXTRACT_GOOGLE_SLIDES_CONTENT
      } else {
        response.error(
          'This page does not appear to be a Google Docs, Sheets, or Slides document.',
        )
        return
      }

      const contentResult = await ctx.browser.evaluate(args.page, extractScript)
      let content: unknown = {}
      let title = ''
      let method = 'unknown'
      try {
        const parsed = JSON.parse(contentResult.value as string)
        content = parsed
        title = ((parsed as Record<string, unknown>).title as string) || ''
        method =
          ((parsed as Record<string, unknown>).method as string) ||
          appType ||
          'js-extract'
      } catch {
        content = contentResult.value
      }

      response.text(
        `${appType} document: ${title || 'untitled'}\n\nDocument ID: ${docId || 'unknown'}\n\nExtracted content:\n${JSON.stringify(content, null, 2)}`,
      )
      response.data({
        appType: appType as 'docs' | 'sheets' | 'slides',
        docId,
        title,
        content,
        method,
      })
    },
  },
)
