import { z } from 'zod'
import { formatDiffResult } from './diff-format'
import { defineTool, intArg, textResult } from './framework'

export const diff = defineTool({
  name: 'diff',
  description:
    "Show what changed on the page since the last snapshot/diff - a cheap way to see an action's effect without re-dumping the whole tree.",
  input: z.object({ page: intArg() }),
  annotations: { title: 'Diff page state', readOnlyHint: true },
  handler: async (args, ctx) => {
    const d = await ctx.session.observe(args.page).diff()
    const origin =
      d.afterUrl ?? ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    const formatted = await formatDiffResult(d, origin)
    return textResult(formatted.text, formatted.structured)
  },
})
