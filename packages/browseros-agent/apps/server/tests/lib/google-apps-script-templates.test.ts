import { describe, it } from 'bun:test'
import assert from 'node:assert'
import {
  appendSheetRow,
  appendSlide,
  appendToDoc,
  findInDoc,
  findInSheet,
  getDocStructure,
  getDocText,
  getSheetNames,
  getSheetValues,
  getSlideCount,
  getSlidesContent,
  insertTextInDoc,
  replaceInDoc,
  setSheetValues,
  updateSlideText,
} from '../../src/lib/google-apps-script-templates'

describe('google-apps-script-templates', () => {
  describe('getDocText', () => {
    it('returns a string', () => {
      const result = getDocText('doc-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = getDocText('doc-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains DocumentApp.openById', () => {
      const result = getDocText('doc-123')
      assert.ok(result.includes('DocumentApp.openById'))
    })

    it('contains body.getText()', () => {
      const result = getDocText('doc-123')
      assert.ok(result.includes('body.getText()'))
    })

    it('contains the documentId', () => {
      const result = getDocText('doc-123')
      assert.ok(result.includes('doc-123'))
    })
  })

  describe('getDocStructure', () => {
    it('returns a string', () => {
      const result = getDocStructure('doc-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = getDocStructure('doc-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains DocumentApp.openById', () => {
      const result = getDocStructure('doc-123')
      assert.ok(result.includes('DocumentApp.openById'))
    })

    it('contains getHeading', () => {
      const result = getDocStructure('doc-123')
      assert.ok(result.includes('getHeading'))
    })

    it('contains JSON.stringify', () => {
      const result = getDocStructure('doc-123')
      assert.ok(result.includes('JSON.stringify'))
    })

    it('contains the documentId', () => {
      const result = getDocStructure('doc-123')
      assert.ok(result.includes('doc-123'))
    })
  })

  describe('findInDoc', () => {
    it('returns a string', () => {
      const result = findInDoc('doc-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = findInDoc('doc-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains DocumentApp.openById', () => {
      const result = findInDoc('doc-123')
      assert.ok(result.includes('DocumentApp.openById'))
    })

    it('contains findText', () => {
      const result = findInDoc('doc-123')
      assert.ok(result.includes('findText'))
    })

    it('contains JSON.stringify', () => {
      const result = findInDoc('doc-123')
      assert.ok(result.includes('JSON.stringify'))
    })

    it('contains the documentId', () => {
      const result = findInDoc('doc-123')
      assert.ok(result.includes('doc-123'))
    })
  })

  describe('insertTextInDoc', () => {
    it('returns a string', () => {
      const result = insertTextInDoc('doc-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = insertTextInDoc('doc-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains DocumentApp.openById', () => {
      const result = insertTextInDoc('doc-123')
      assert.ok(result.includes('DocumentApp.openById'))
    })

    it('contains insertParagraph', () => {
      const result = insertTextInDoc('doc-123')
      assert.ok(result.includes('insertParagraph'))
    })

    it('contains appendParagraph', () => {
      const result = insertTextInDoc('doc-123')
      assert.ok(result.includes('appendParagraph'))
    })

    it('contains the documentId', () => {
      const result = insertTextInDoc('doc-123')
      assert.ok(result.includes('doc-123'))
    })
  })

  describe('replaceInDoc', () => {
    it('returns a string', () => {
      const result = replaceInDoc('doc-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = replaceInDoc('doc-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains DocumentApp.openById', () => {
      const result = replaceInDoc('doc-123')
      assert.ok(result.includes('DocumentApp.openById'))
    })

    it('contains replaceText', () => {
      const result = replaceInDoc('doc-123')
      assert.ok(result.includes('replaceText'))
    })

    it('contains the documentId', () => {
      const result = replaceInDoc('doc-123')
      assert.ok(result.includes('doc-123'))
    })
  })

  describe('appendToDoc', () => {
    it('returns a string', () => {
      const result = appendToDoc('doc-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = appendToDoc('doc-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains DocumentApp.openById', () => {
      const result = appendToDoc('doc-123')
      assert.ok(result.includes('DocumentApp.openById'))
    })

    it('contains appendParagraph', () => {
      const result = appendToDoc('doc-123')
      assert.ok(result.includes('appendParagraph'))
    })

    it('contains the documentId', () => {
      const result = appendToDoc('doc-123')
      assert.ok(result.includes('doc-123'))
    })
  })

  describe('getSheetValues', () => {
    it('returns a string', () => {
      const result = getSheetValues('sheet-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = getSheetValues('sheet-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SpreadsheetApp.openById', () => {
      const result = getSheetValues('sheet-123')
      assert.ok(result.includes('SpreadsheetApp.openById'))
    })

    it('contains getValues', () => {
      const result = getSheetValues('sheet-123')
      assert.ok(result.includes('getValues'))
    })

    it('contains the spreadsheetId', () => {
      const result = getSheetValues('sheet-123')
      assert.ok(result.includes('sheet-123'))
    })
  })

  describe('getSheetNames', () => {
    it('returns a string', () => {
      const result = getSheetNames('sheet-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = getSheetNames('sheet-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SpreadsheetApp.openById', () => {
      const result = getSheetNames('sheet-123')
      assert.ok(result.includes('SpreadsheetApp.openById'))
    })

    it('contains getSheets', () => {
      const result = getSheetNames('sheet-123')
      assert.ok(result.includes('getSheets'))
    })

    it('contains the spreadsheetId', () => {
      const result = getSheetNames('sheet-123')
      assert.ok(result.includes('sheet-123'))
    })
  })

  describe('setSheetValues', () => {
    it('returns a string', () => {
      const result = setSheetValues('sheet-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = setSheetValues('sheet-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SpreadsheetApp.openById', () => {
      const result = setSheetValues('sheet-123')
      assert.ok(result.includes('SpreadsheetApp.openById'))
    })

    it('contains setValues', () => {
      const result = setSheetValues('sheet-123')
      assert.ok(result.includes('setValues'))
    })

    it('contains the spreadsheetId', () => {
      const result = setSheetValues('sheet-123')
      assert.ok(result.includes('sheet-123'))
    })
  })

  describe('appendSheetRow', () => {
    it('returns a string', () => {
      const result = appendSheetRow('sheet-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = appendSheetRow('sheet-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SpreadsheetApp.openById', () => {
      const result = appendSheetRow('sheet-123')
      assert.ok(result.includes('SpreadsheetApp.openById'))
    })

    it('contains appendRow', () => {
      const result = appendSheetRow('sheet-123')
      assert.ok(result.includes('appendRow'))
    })

    it('contains the spreadsheetId', () => {
      const result = appendSheetRow('sheet-123')
      assert.ok(result.includes('sheet-123'))
    })
  })

  describe('findInSheet', () => {
    it('returns a string', () => {
      const result = findInSheet('sheet-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = findInSheet('sheet-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SpreadsheetApp.openById', () => {
      const result = findInSheet('sheet-123')
      assert.ok(result.includes('SpreadsheetApp.openById'))
    })

    it('contains indexOf or findText', () => {
      const result = findInSheet('sheet-123')
      assert.ok(result.includes('indexOf') || result.includes('findText'))
    })

    it('contains the spreadsheetId', () => {
      const result = findInSheet('sheet-123')
      assert.ok(result.includes('sheet-123'))
    })
  })

  describe('getSlidesContent', () => {
    it('returns a string', () => {
      const result = getSlidesContent('pres-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = getSlidesContent('pres-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SlidesApp.openById', () => {
      const result = getSlidesContent('pres-123')
      assert.ok(result.includes('SlidesApp.openById'))
    })

    it('contains getSlides', () => {
      const result = getSlidesContent('pres-123')
      assert.ok(result.includes('getSlides'))
    })

    it('contains the presentationId', () => {
      const result = getSlidesContent('pres-123')
      assert.ok(result.includes('pres-123'))
    })
  })

  describe('getSlideCount', () => {
    it('returns a string', () => {
      const result = getSlideCount('pres-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = getSlideCount('pres-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SlidesApp.openById', () => {
      const result = getSlideCount('pres-123')
      assert.ok(result.includes('SlidesApp.openById'))
    })

    it('contains getSlides', () => {
      const result = getSlideCount('pres-123')
      assert.ok(result.includes('getSlides'))
    })

    it('contains the presentationId', () => {
      const result = getSlideCount('pres-123')
      assert.ok(result.includes('pres-123'))
    })
  })

  describe('appendSlide', () => {
    it('returns a string', () => {
      const result = appendSlide('pres-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = appendSlide('pres-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SlidesApp.openById', () => {
      const result = appendSlide('pres-123')
      assert.ok(result.includes('SlidesApp.openById'))
    })

    it('contains appendSlide', () => {
      const result = appendSlide('pres-123')
      assert.ok(result.includes('appendSlide'))
    })

    it('contains the presentationId', () => {
      const result = appendSlide('pres-123')
      assert.ok(result.includes('pres-123'))
    })
  })

  describe('updateSlideText', () => {
    it('returns a string', () => {
      const result = updateSlideText('pres-123')
      assert.strictEqual(typeof result, 'string')
    })

    it('contains function main(params)', () => {
      const result = updateSlideText('pres-123')
      assert.ok(result.includes('function main(params)'))
    })

    it('contains SlidesApp.openById', () => {
      const result = updateSlideText('pres-123')
      assert.ok(result.includes('SlidesApp.openById'))
    })

    it('contains replaceAllText', () => {
      const result = updateSlideText('pres-123')
      assert.ok(result.includes('replaceAllText'))
    })

    it('contains the presentationId', () => {
      const result = updateSlideText('pres-123')
      assert.ok(result.includes('pres-123'))
    })
  })
})
