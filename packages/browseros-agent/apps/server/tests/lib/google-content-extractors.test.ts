import { describe, it } from 'bun:test'
import assert from 'node:assert'
import {
  DETECT_GOOGLE_APP,
  EXTRACT_GOOGLE_DOCS_STRUCTURE,
  EXTRACT_GOOGLE_DOCS_TEXT,
  EXTRACT_GOOGLE_SHEETS_CONTENT,
  EXTRACT_GOOGLE_SLIDES_CONTENT,
  GET_GOOGLE_DOC_ID,
} from '../../src/lib/google-content-extractors'

describe('google-content-extractors', () => {
  describe('DETECT_GOOGLE_APP', () => {
    it('is a string', () => {
      assert.strictEqual(typeof DETECT_GOOGLE_APP, 'string')
    })

    it('contains IIFE pattern', () => {
      assert.ok(DETECT_GOOGLE_APP.includes('(function()'))
    })

    it("contains 'docs'", () => {
      assert.ok(DETECT_GOOGLE_APP.includes("'docs'"))
    })

    it("contains 'sheets'", () => {
      assert.ok(DETECT_GOOGLE_APP.includes("'sheets'"))
    })

    it("contains 'slides'", () => {
      assert.ok(DETECT_GOOGLE_APP.includes("'slides'"))
    })

    it('contains window.location.href', () => {
      assert.ok(DETECT_GOOGLE_APP.includes('window.location.href'))
    })

    it('is syntactically valid JavaScript', () => {
      assert.doesNotThrow(() => new Function(DETECT_GOOGLE_APP))
    })
  })

  describe('EXTRACT_GOOGLE_DOCS_TEXT', () => {
    it('is a string', () => {
      assert.strictEqual(typeof EXTRACT_GOOGLE_DOCS_TEXT, 'string')
    })

    it('contains IIFE pattern', () => {
      assert.ok(EXTRACT_GOOGLE_DOCS_TEXT.includes('(function()'))
    })

    it('contains JSON.stringify', () => {
      assert.ok(EXTRACT_GOOGLE_DOCS_TEXT.includes('JSON.stringify'))
    })

    it('contains kix-paragraphrenderer or contenteditable', () => {
      assert.ok(
        EXTRACT_GOOGLE_DOCS_TEXT.includes('kix-paragraphrenderer') ||
          EXTRACT_GOOGLE_DOCS_TEXT.includes('contenteditable'),
      )
    })

    it('is syntactically valid JavaScript', () => {
      assert.doesNotThrow(() => new Function(EXTRACT_GOOGLE_DOCS_TEXT))
    })
  })

  describe('EXTRACT_GOOGLE_DOCS_STRUCTURE', () => {
    it('is a string', () => {
      assert.strictEqual(typeof EXTRACT_GOOGLE_DOCS_STRUCTURE, 'string')
    })

    it('contains IIFE pattern', () => {
      assert.ok(EXTRACT_GOOGLE_DOCS_STRUCTURE.includes('(function()'))
    })

    it('contains JSON.stringify', () => {
      assert.ok(EXTRACT_GOOGLE_DOCS_STRUCTURE.includes('JSON.stringify'))
    })

    it('contains headings', () => {
      assert.ok(EXTRACT_GOOGLE_DOCS_STRUCTURE.includes('headings'))
    })

    it('is syntactically valid JavaScript', () => {
      assert.doesNotThrow(() => new Function(EXTRACT_GOOGLE_DOCS_STRUCTURE))
    })
  })

  describe('EXTRACT_GOOGLE_SHEETS_CONTENT', () => {
    it('is a string', () => {
      assert.strictEqual(typeof EXTRACT_GOOGLE_SHEETS_CONTENT, 'string')
    })

    it('contains IIFE pattern', () => {
      assert.ok(EXTRACT_GOOGLE_SHEETS_CONTENT.includes('(function()'))
    })

    it('contains JSON.stringify', () => {
      assert.ok(EXTRACT_GOOGLE_SHEETS_CONTENT.includes('JSON.stringify'))
    })

    it('contains sheets', () => {
      assert.ok(EXTRACT_GOOGLE_SHEETS_CONTENT.includes('sheets'))
    })

    it('is syntactically valid JavaScript', () => {
      assert.doesNotThrow(() => new Function(EXTRACT_GOOGLE_SHEETS_CONTENT))
    })
  })

  describe('EXTRACT_GOOGLE_SLIDES_CONTENT', () => {
    it('is a string', () => {
      assert.strictEqual(typeof EXTRACT_GOOGLE_SLIDES_CONTENT, 'string')
    })

    it('contains IIFE pattern', () => {
      assert.ok(EXTRACT_GOOGLE_SLIDES_CONTENT.includes('(function()'))
    })

    it('contains JSON.stringify', () => {
      assert.ok(EXTRACT_GOOGLE_SLIDES_CONTENT.includes('JSON.stringify'))
    })

    it('contains slideCount', () => {
      assert.ok(EXTRACT_GOOGLE_SLIDES_CONTENT.includes('slideCount'))
    })

    it('is syntactically valid JavaScript', () => {
      assert.doesNotThrow(() => new Function(EXTRACT_GOOGLE_SLIDES_CONTENT))
    })
  })

  describe('GET_GOOGLE_DOC_ID', () => {
    it('is a string', () => {
      assert.strictEqual(typeof GET_GOOGLE_DOC_ID, 'string')
    })

    it('contains IIFE pattern', () => {
      assert.ok(GET_GOOGLE_DOC_ID.includes('(function()'))
    })

    it('contains docId', () => {
      assert.ok(GET_GOOGLE_DOC_ID.includes('docId'))
    })

    it('contains /document/d/ pattern', () => {
      assert.ok(GET_GOOGLE_DOC_ID.includes('\\/document\\/d\\/'))
    })

    it('contains /spreadsheets/d/ pattern', () => {
      assert.ok(GET_GOOGLE_DOC_ID.includes('\\/spreadsheets\\/d\\/'))
    })

    it('is syntactically valid JavaScript', () => {
      assert.doesNotThrow(() => new Function(GET_GOOGLE_DOC_ID))
    })
  })
})
