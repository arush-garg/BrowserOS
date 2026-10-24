import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import {
  decideObservation,
  truncateSnapshot,
} from './observation-policy'
import { wrapUntrusted } from './trust-boundary'

/**
 * Adaptive observation: accessibility tree by default, screenshot only
 * when it is actually needed.
 *
 * - mode="ax": snapshot only (truncation is reported, never silent).
 * - mode="screenshot": annotated screenshot only.
 * - mode="auto" (default): snapshot; if it fails or is empty, fall back
 *   to an annotated screenshot; if the caller signals canvas/image-heavy
 *   content or asks for visual verification, return both tree and
 *   annotated screenshot. Screenshots are not taken on every step.
 */
export const observe_page = defineTool({
  name: 'observe_page',
  description:
    'Observe a page adaptively: accessibility tree by default, annotated screenshot only for visual verification, canvas/image-heavy pages, or when the snapshot fails or is empty. Snapshot truncation is always reported with the dropped refs.',
  input: z
    .object({
      page: z.number().int(),
      mode: z.enum(['auto', 'ax', 'screenshot']).default('auto'),
      maxLines: z.number().int().min(1).max(20_000).default(2_000),
      visualVerification: z
        .boolean()
        .default(false)
        .describe('Request an annotated screenshot alongside the tree.'),
      canvasPresent: z
        .boolean()
        .default(false)
        .describe('Caller signal: the page contains canvas content the AX tree cannot describe.'),
      imageHeavy: z
        .boolean()
        .default(false)
        .describe('Caller signal: the page is image-heavy and the AX tree is insufficient.'),
    })
    .strict(),
  annotations: { title: 'Observe page adaptively', readOnlyHint: true },
  handler: async (args, ctx) => {
    const origin =
      ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'

    if (args.mode === 'screenshot') {
      const shot = await ctx.session.screenshot(args.page, {
        format: 'jpeg',
        annotate: true,
      })
      return {
        content: [
          {
            type: 'text',
            text: `annotated screenshot for page ${args.page} (screenshot mode requested)`,
          },
          { type: 'image', data: shot.data, mimeType: shot.mimeType },
        ],
        structuredContent: {
          page: args.page,
          mode: 'screenshot',
          reason: 'screenshot mode requested',
          annotations: shot.annotations,
        },
      }
    }

    let snapshotText: string | undefined
    let snapshotError: string | undefined
    try {
      snapshotText = (await ctx.session.observe(args.page).snapshot()).text
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : String(err)
    }

    if (snapshotText === undefined) {
      if (args.mode === 'ax') {
        return errorResult(`observe_page: snapshot failed: ${snapshotError}`)
      }
      try {
        const shot = await ctx.session.screenshot(args.page, {
          format: 'jpeg',
          annotate: true,
        })
        return {
          content: [
            {
              type: 'text',
              text: `accessibility snapshot failed (${snapshotError}); falling back to annotated screenshot for page ${args.page}`,
            },
            { type: 'image', data: shot.data, mimeType: shot.mimeType },
          ],
          structuredContent: {
            page: args.page,
            mode: 'screenshot',
            reason: 'snapshot failed; screenshot fallback',
            snapshotError,
            annotations: shot.annotations,
          },
        }
      } catch (shotError) {
        return errorResult(
          `observe_page: snapshot failed (${snapshotError}) and screenshot fallback failed (${shotError instanceof Error ? shotError.message : String(shotError)})`,
        )
      }
    }

    const truncated = truncateSnapshot(snapshotText, args.maxLines)
    const decision = decideObservation({
      snapshotFailed: false,
      snapshotEmpty: snapshotText.trim() === '',
      canvasPresent: args.canvasPresent,
      imageHeavy: args.imageHeavy,
      visualVerificationRequested: args.visualVerification,
    })
    const treeText = wrapUntrusted(truncated.text, origin)
    const header = truncated.header
      ? `${truncated.header}\n`
      : ''
    const structured = {
      page: args.page,
      mode: decision.mode,
      reason: decision.reason,
      truncated: truncated.truncated,
      totalLines: truncated.totalLines,
      returnedLines: truncated.returnedLines,
      droppedRefs: truncated.droppedRefs,
    }

    if (decision.mode === 'ax') {
      return textResult(`${header}${treeText}`, structured)
    }

    const shot = await ctx.session.screenshot(args.page, {
      format: 'jpeg',
      annotate: true,
    })
    return {
      content: [
        { type: 'text', text: `${header}${treeText}` },
        { type: 'image', data: shot.data, mimeType: shot.mimeType },
      ],
      structuredContent: {
        ...structured,
        annotations: shot.annotations,
      },
    }
  },
})
