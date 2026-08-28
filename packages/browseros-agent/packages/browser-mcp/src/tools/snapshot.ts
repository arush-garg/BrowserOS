import { z } from 'zod'
import { defineTool, intArg, textResult } from './framework'
import { extractGoogleSerp, isGoogleSerp } from './serp-extract'
import { formatSnapshotResult } from './snapshot-format'

export const snapshot = defineTool({
  name: 'snapshot',
  description:
    'Capture the page as an indented accessibility tree. Each actionable element carries a stable [ref=eN] you pass to `act`. Iframe content is stitched in inline. Re-snapshot after navigation or large changes (refs are invalidated). This is the start of the loop: snapshot -> act -> (reads back a diff). Set `includeScreenshot: true` to also return a JPEG of the page in the same response (skips a separate `screenshot` tool call).',
  input: z.object({
    page: intArg().describe('Page id from `tabs` or `navigate`.'),
    includeScreenshot: z
      .boolean()
      .optional()
      .describe(
        'Also capture a JPEG screenshot and return it alongside the accessibility tree.',
      ),
  }),
  annotations: { title: 'Snapshot accessibility tree', readOnlyHint: true },
  handler: async (args, ctx) => {
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'

    let snapshotText: string
    if (isGoogleSerp(origin)) {
      const extracted = await extractGoogleSerp(ctx, args.page)
      snapshotText =
        extracted ?? (await ctx.session.observe(args.page).snapshot()).text
    } else {
      snapshotText = (await ctx.session.observe(args.page).snapshot()).text
    }

    const formatted = await formatSnapshotResult(snapshotText, origin)
    const structured = { page: args.page, ...formatted.structured }

    if (!args.includeScreenshot) {
      return textResult(formatted.text, structured)
    }

    const { session: pageSession } = await ctx.session.pages.getSession(
      args.page,
    )
    const shot = await pageSession.Page.captureScreenshot({
      format: 'jpeg',
      quality: 80,
      captureBeyondViewport: false,
    })

    return {
      content: [
        { type: 'text', text: formatted.text },
        { type: 'image', data: shot.data, mimeType: 'image/jpeg' },
      ],
      structuredContent: structured,
    }
  },
})
