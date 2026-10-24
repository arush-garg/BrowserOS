import { z } from 'zod/v4'
import { defineTool, textResult } from './framework'
import { truncateSnapshot } from './observation-policy'
import { formatSnapshotResult } from './snapshot-format'

export const snapshot = defineTool({
  name: 'snapshot',
  description:
    'Capture the page as an indented accessibility tree. Each actionable element carries a stable [ref=eN] you pass to `act`. Iframe content is stitched in inline. Re-snapshot after navigation or large changes (refs are invalidated). This is the start of the loop: snapshot -> act -> (reads back a diff).',
  input: z
    .object({
      page: z.number().int().describe('Page id from `tabs` or `navigate`.'),
      mode: z
        .enum(['full', 'interactive', 'compact'])
        .default('full')
        .describe(
          'full tree, interactive lines only, or compact bounded tree.',
        ),
      timeoutMs: z.number().int().min(100).max(60_000).default(15_000),
      maxLines: z.number().int().min(1).max(20_000).default(2_000),
    })
    .strict(),
  annotations: { title: 'Snapshot accessibility tree', readOnlyHint: true },
  handler: async (args, ctx) => {
    let timedOut = false
    const snapshotPromise = ctx.session.observe(args.page).snapshot()
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('snapshot deadline exceeded')),
        args.timeoutMs,
      ),
    )
    let snapshot: Awaited<typeof snapshotPromise>
    try {
      snapshot = await Promise.race([snapshotPromise, timeout])
    } catch (error) {
      timedOut = true
      if (args.mode === 'full') throw error
      const { session } = await ctx.session.pages.getSession(args.page)
      const result = await session.Runtime.evaluate({
        expression: `document.body?.innerText ?? ''`,
        returnByValue: true,
      })
      snapshot = {
        text: String(result.result?.value ?? ''),
        url: ctx.session.pages.getInfo(args.page)?.url ?? 'unknown',
      } as Awaited<typeof snapshotPromise>
    }
    const rawLines = snapshot.text.split('\n')
    const lines =
      args.mode === 'interactive'
        ? rawLines.filter((line) => /\[ref=e\d+\]/.test(line))
        : rawLines
    // Truncation is reported explicitly, with the dropped refs named, so
    // "not in my snapshot" is never mistaken for "not on the page".
    const truncated = truncateSnapshot(lines.join('\n'), args.maxLines)
    const partial = timedOut || truncated.truncated
    const text = truncated.text
    const origin =
      ctx.session.pages.getInfo(args.page)?.url ?? snapshot.url ?? 'unknown'
    const formatted = await formatSnapshotResult(text, origin)
    return textResult(
      `${partial ? `[partial ${args.mode} snapshot]\n` : ''}${truncated.header ? `${truncated.header}\n` : ''}${formatted.text}`,
      {
        page: args.page,
        mode: args.mode,
        partial,
        timedOut,
        totalLines: truncated.totalLines,
        returnedLines: truncated.returnedLines,
        droppedLines: truncated.droppedLines,
        droppedRefs: truncated.droppedRefs,
        ...formatted.structured,
      },
    )
  },
})
