import { describe, expect, it } from 'bun:test'
import {
  completedImportItemCount,
  DEFAULT_BROWSEROS_IMPORT_SOURCE_ID,
  importItemLabel,
  importItemListLabel,
  importProgressTotal,
  MOCK_BROWSEROS_IMPORT_SOURCES,
  STARTER_PROMPTS,
  selectableItemsForSource,
  selectedSourceById,
  startImportRequestFor,
} from './onboarding-v2.helpers'

describe('MOCK_BROWSEROS_IMPORT_SOURCES fixture', () => {
  it('ships mock import sources with stable ids', () => {
    expect(MOCK_BROWSEROS_IMPORT_SOURCES.map((source) => source.id)).toEqual([
      'chrome-work',
      'chrome-personal',
      'edge-default',
    ])
    expect(DEFAULT_BROWSEROS_IMPORT_SOURCE_ID).toBe('chrome-work')
  })

  it('uses the Chromium contract source shape', () => {
    for (const source of MOCK_BROWSEROS_IMPORT_SOURCES) {
      expect(source.displayName.length).toBeGreaterThan(0)
      expect(source.recommendedItems.length).toBeGreaterThan(0)
      expect(source.supportedItems).toContain(source.recommendedItems[0])
    }
  })
})

describe('source selection helpers', () => {
  it('finds the selected source by contract id', () => {
    expect(
      selectedSourceById(MOCK_BROWSEROS_IMPORT_SOURCES, 'chrome-personal')
        ?.displayName,
    ).toBe('Google Chrome - Personal')
  })

  it('falls back to supported items when recommended items are empty', () => {
    expect(
      selectableItemsForSource({
        ...MOCK_BROWSEROS_IMPORT_SOURCES[0],
        recommendedItems: [],
      }),
    ).toEqual(MOCK_BROWSEROS_IMPORT_SOURCES[0].supportedItems)
  })

  it('builds the Chromium start-import request for one source', () => {
    expect(startImportRequestFor(MOCK_BROWSEROS_IMPORT_SOURCES[0])).toEqual({
      sourceId: 'chrome-work',
      items: MOCK_BROWSEROS_IMPORT_SOURCES[0].recommendedItems,
    })
  })

  it('does not build a start-import request for empty item sources', () => {
    expect(
      startImportRequestFor({
        ...MOCK_BROWSEROS_IMPORT_SOURCES[0],
        recommendedItems: [],
        supportedItems: [],
      }),
    ).toBeNull()
  })
})

describe('import item display helpers', () => {
  it('formats import item labels for source tiles and summaries', () => {
    expect(importItemListLabel(['history', 'bookmarks', 'cookies'])).toBe(
      'History, Bookmarks, Cookies',
    )
  })

  it('falls back to readable labels for unknown Chromium item strings', () => {
    expect(importItemLabel('savedWindows')).toBe('Saved Windows')
    expect(importItemListLabel(['history', 'savedWindows'])).toBe(
      'History, Saved Windows',
    )
  })

  it('uses Chromium progress totals when present', () => {
    expect(
      importProgressTotal(MOCK_BROWSEROS_IMPORT_SOURCES[0], {
        currentItem: 'cookies',
        completedItems: ['history', 'bookmarks'],
        totalItems: 7,
      }),
    ).toBe(7)
    expect(
      completedImportItemCount({
        currentItem: 'cookies',
        completedItems: ['history', 'bookmarks'],
        totalItems: 7,
      }),
    ).toBe(2)
  })
})

describe('STARTER_PROMPTS', () => {
  it('ships at least two suggestions for the Ready step', () => {
    expect(STARTER_PROMPTS.length).toBeGreaterThanOrEqual(2)
  })
})
