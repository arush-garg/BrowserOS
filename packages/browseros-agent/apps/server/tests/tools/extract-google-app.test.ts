import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { extract_google_app_content } from '../../src/tools/custom/extract-google-app'
import { executeTool } from '../../src/tools/framework'

describe('extract_google_app_content tool', () => {
  it('returns extracted docs content', async () => {
    let callCount = 0
    const fakeBrowser: any = {
      evaluate: async (_page: number, _script: string) => {
        callCount++
        // DETECT_GOOGLE_APP returns a bare string (not JSON-encoded)
        if (callCount === 1) return { value: 'docs' }
        // GET_GOOGLE_DOC_ID returns a JSON string
        if (callCount === 2)
          return { value: '{"docId":"abc123","appType":"docs"}' }
        return {
          value:
            '{"title":"My Doc","text":"Hello world","method":"kix-paragraph"}',
        }
      },
      getTabIdForPage: () => undefined,
    }

    const ctx = {
      browser: fakeBrowser,
      directories: { workingDir: process.cwd() },
    }

    const result = await executeTool(
      extract_google_app_content as any,
      { page: 1, mode: 'auto' },
      ctx as any,
      AbortSignal.timeout(5000),
    )

    assert.ok(!result.isError, String(result))
    assert.strictEqual(result.structuredContent?.appType, 'docs')
    assert.strictEqual(result.structuredContent?.docId, 'abc123')
    assert.strictEqual(result.structuredContent?.title, 'My Doc')
  })

  it('handles sheets pages', async () => {
    let callCount = 0
    const fakeBrowser: any = {
      evaluate: async (_page: number, _script: string) => {
        callCount++
        // DETECT_GOOGLE_APP returns a bare string (not JSON-encoded)
        if (callCount === 1) return { value: 'sheets' }
        // GET_GOOGLE_DOC_ID returns a JSON string
        if (callCount === 2)
          return { value: '{"docId":"sheet456","appType":"sheets"}' }
        return {
          value:
            '{"title":"My Sheet","activeSheet":"Sheet1","sheets":["Sheet1"]}',
        }
      },
      getTabIdForPage: () => undefined,
    }

    const ctx = {
      browser: fakeBrowser,
      directories: { workingDir: process.cwd() },
    }

    const result = await executeTool(
      extract_google_app_content as any,
      { page: 1, mode: 'auto' },
      ctx as any,
      AbortSignal.timeout(5000),
    )

    assert.ok(!result.isError, String(result))
    assert.strictEqual(result.structuredContent?.appType, 'sheets')
  })

  it('errors on non-Google pages', async () => {
    const fakeBrowser: any = {
      evaluate: async (_page: number, _script: string) => {
        return { value: null }
      },
      getTabIdForPage: () => undefined,
    }

    const ctx = {
      browser: fakeBrowser,
      directories: { workingDir: process.cwd() },
    }

    const result = await executeTool(
      extract_google_app_content as any,
      { page: 1, mode: 'auto' },
      ctx as any,
      AbortSignal.timeout(5000),
    )

    assert.ok(result.isError, 'Expected isError to be true for non-Google page')
  })
})
