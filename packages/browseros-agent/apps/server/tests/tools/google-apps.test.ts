import { describe, it } from 'bun:test'
import assert from 'node:assert'
import {
  createEditGoogleDocTool,
  createEditGoogleSheetTool,
  createEditGoogleSlidesTool,
  createReadGoogleDocTool,
  createReadGoogleSheetTool,
  createReadGoogleSlidesTool,
} from '../../src/tools/custom/google-apps'

describe('google-apps AI SDK tools', () => {
  describe('createReadGoogleDocTool', () => {
    it('creates a tool object with required properties', () => {
      const t = createReadGoogleDocTool()
      assert.ok(t !== null && t !== undefined)
      assert.strictEqual(typeof t.description, 'string')
      assert.ok(t.description.length > 0)
      assert.ok(t.inputSchema !== null && t.inputSchema !== undefined)
      assert.strictEqual(typeof t.execute, 'function')
    })

    it('has a description mentioning Google Doc', () => {
      const t = createReadGoogleDocTool()
      assert.ok(t.description.toLowerCase().includes('google doc'))
    })

    it('inputSchema accepts valid params', () => {
      const t = createReadGoogleDocTool()
      const result = (t.inputSchema as any).safeParse({ documentId: 'doc-abc' })
      assert.ok(result.success)
    })

    it('inputSchema rejects missing documentId', () => {
      const t = createReadGoogleDocTool()
      const result = (t.inputSchema as any).safeParse({})
      assert.ok(!result.success)
    })
  })

  describe('createReadGoogleSheetTool', () => {
    it('creates a tool object with required properties', () => {
      const t = createReadGoogleSheetTool()
      assert.ok(t !== null && t !== undefined)
      assert.strictEqual(typeof t.description, 'string')
      assert.ok(t.description.length > 0)
      assert.ok(t.inputSchema !== null && t.inputSchema !== undefined)
      assert.strictEqual(typeof t.execute, 'function')
    })

    it('has a description mentioning spreadsheet', () => {
      const t = createReadGoogleSheetTool()
      assert.ok(t.description.toLowerCase().includes('spreadsheet'))
    })

    it('inputSchema accepts valid params', () => {
      const t = createReadGoogleSheetTool()
      const result = (t.inputSchema as any).safeParse({
        spreadsheetId: 'sheet-abc',
      })
      assert.ok(result.success)
    })

    it('inputSchema rejects missing spreadsheetId', () => {
      const t = createReadGoogleSheetTool()
      const result = (t.inputSchema as any).safeParse({})
      assert.ok(!result.success)
    })
  })

  describe('createReadGoogleSlidesTool', () => {
    it('creates a tool object with required properties', () => {
      const t = createReadGoogleSlidesTool()
      assert.ok(t !== null && t !== undefined)
      assert.strictEqual(typeof t.description, 'string')
      assert.ok(t.description.length > 0)
      assert.ok(t.inputSchema !== null && t.inputSchema !== undefined)
      assert.strictEqual(typeof t.execute, 'function')
    })

    it('has a description mentioning slides', () => {
      const t = createReadGoogleSlidesTool()
      assert.ok(t.description.toLowerCase().includes('slides'))
    })

    it('inputSchema accepts valid params', () => {
      const t = createReadGoogleSlidesTool()
      const result = (t.inputSchema as any).safeParse({
        presentationId: 'pres-abc',
      })
      assert.ok(result.success)
    })

    it('inputSchema rejects missing presentationId', () => {
      const t = createReadGoogleSlidesTool()
      const result = (t.inputSchema as any).safeParse({})
      assert.ok(!result.success)
    })
  })

  describe('createEditGoogleDocTool', () => {
    it('creates a tool object with required properties', () => {
      const t = createEditGoogleDocTool()
      assert.ok(t !== null && t !== undefined)
      assert.strictEqual(typeof t.description, 'string')
      assert.ok(t.description.length > 0)
      assert.ok(t.inputSchema !== null && t.inputSchema !== undefined)
      assert.strictEqual(typeof t.execute, 'function')
    })

    it('has a description mentioning edit', () => {
      const t = createEditGoogleDocTool()
      assert.ok(t.description.toLowerCase().includes('edit'))
    })

    it('inputSchema accepts valid append params', () => {
      const t = createEditGoogleDocTool()
      const result = (t.inputSchema as any).safeParse({
        documentId: 'doc-abc',
        operation: 'append',
        text: 'Hello world',
      })
      assert.ok(result.success)
    })

    it('inputSchema accepts valid replace params', () => {
      const t = createEditGoogleDocTool()
      const result = (t.inputSchema as any).safeParse({
        documentId: 'doc-abc',
        operation: 'replace',
        find: 'old text',
        replace: 'new text',
      })
      assert.ok(result.success)
    })

    it('inputSchema rejects invalid operation', () => {
      const t = createEditGoogleDocTool()
      const result = (t.inputSchema as any).safeParse({
        documentId: 'doc-abc',
        operation: 'delete',
      })
      assert.ok(!result.success)
    })

    it('inputSchema rejects missing documentId', () => {
      const t = createEditGoogleDocTool()
      const result = (t.inputSchema as any).safeParse({
        operation: 'append',
        text: 'Hello',
      })
      assert.ok(!result.success)
    })
  })

  describe('createEditGoogleSheetTool', () => {
    it('creates a tool object with required properties', () => {
      const t = createEditGoogleSheetTool()
      assert.ok(t !== null && t !== undefined)
      assert.strictEqual(typeof t.description, 'string')
      assert.ok(t.description.length > 0)
      assert.ok(t.inputSchema !== null && t.inputSchema !== undefined)
      assert.strictEqual(typeof t.execute, 'function')
    })

    it('has a description mentioning spreadsheet', () => {
      const t = createEditGoogleSheetTool()
      assert.ok(t.description.toLowerCase().includes('spreadsheet'))
    })

    it('inputSchema accepts valid set_values params', () => {
      const t = createEditGoogleSheetTool()
      const result = (t.inputSchema as any).safeParse({
        spreadsheetId: 'sheet-abc',
        operation: 'set_values',
        range: 'A1:B2',
        values: [['a', 'b']],
      })
      assert.ok(result.success)
    })

    it('inputSchema accepts valid append_row params', () => {
      const t = createEditGoogleSheetTool()
      const result = (t.inputSchema as any).safeParse({
        spreadsheetId: 'sheet-abc',
        operation: 'append_row',
        values: [['val1', 'val2']],
      })
      assert.ok(result.success)
    })

    it('inputSchema rejects invalid operation', () => {
      const t = createEditGoogleSheetTool()
      const result = (t.inputSchema as any).safeParse({
        spreadsheetId: 'sheet-abc',
        operation: 'delete_row',
      })
      assert.ok(!result.success)
    })
  })

  describe('createEditGoogleSlidesTool', () => {
    it('creates a tool object with required properties', () => {
      const t = createEditGoogleSlidesTool()
      assert.ok(t !== null && t !== undefined)
      assert.strictEqual(typeof t.description, 'string')
      assert.ok(t.description.length > 0)
      assert.ok(t.inputSchema !== null && t.inputSchema !== undefined)
      assert.strictEqual(typeof t.execute, 'function')
    })

    it('has a description mentioning slides', () => {
      const t = createEditGoogleSlidesTool()
      assert.ok(t.description.toLowerCase().includes('slides'))
    })

    it('inputSchema accepts valid append_slide params', () => {
      const t = createEditGoogleSlidesTool()
      const result = (t.inputSchema as any).safeParse({
        presentationId: 'pres-abc',
        operation: 'append_slide',
        title: 'New Slide',
        body: 'Slide body text',
      })
      assert.ok(result.success)
    })

    it('inputSchema accepts valid replace_text params', () => {
      const t = createEditGoogleSlidesTool()
      const result = (t.inputSchema as any).safeParse({
        presentationId: 'pres-abc',
        operation: 'replace_text',
        slideIndex: 0,
        find: 'old',
        replace: 'new',
      })
      assert.ok(result.success)
    })

    it('inputSchema rejects invalid operation', () => {
      const t = createEditGoogleSlidesTool()
      const result = (t.inputSchema as any).safeParse({
        presentationId: 'pres-abc',
        operation: 'delete_slide',
      })
      assert.ok(!result.success)
    })

    it('inputSchema rejects missing presentationId', () => {
      const t = createEditGoogleSlidesTool()
      const result = (t.inputSchema as any).safeParse({
        operation: 'append_slide',
      })
      assert.ok(!result.success)
    })
  })
})
