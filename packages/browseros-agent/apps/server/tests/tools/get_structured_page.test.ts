import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { get_structured_page } from '../../src/tools/legacy/browser/dom'
import { executeTool } from '../../src/tools/legacy/framework'

describe('get_structured_page tool', () => {
  it('returns structured data from mocked browser', async () => {
    const fakeBrowser: any = {
      getStructuredPage: async (page: number, opts: any) => ({
        url: 'data:text/plain,hello',
        title: 'hello',
        elements: [
          { backendNodeId: 1, tag: 'button', text: 'Click me', role: 'button' },
        ],
        pageText: '# Hello\nThis is content',
      }),
      getTabIdForPage: () => undefined,
    }

    const ctx = {
      browser: fakeBrowser,
      directories: { workingDir: process.cwd() },
    }
    const res = await executeTool(
      get_structured_page as any,
      { page: 1 },
      ctx as any,
      AbortSignal.timeout(5000),
    )
    assert.ok(!res.isError, String(res))
    const data = res.structuredContent as Record<string, unknown>
    assert.strictEqual(data?.title, 'hello')
    assert.strictEqual(Array.isArray(data?.elements), true)
    assert.strictEqual((data?.contentLength as number) > 0, true)
  })
})
