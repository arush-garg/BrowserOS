/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import { logger } from '../../lib/logger'

export async function resolveBrowserContextPageIds(
  browser: Pick<Browser, 'resolveTabIds' | 'listPages' | 'newPage'>,
  browserContext?: BrowserContext,
): Promise<BrowserContext | undefined> {
  if (!browserContext) return undefined

  const tabIdSet = new Set<number>()
  if (browserContext.activeTab) tabIdSet.add(browserContext.activeTab.id)
  if (browserContext.selectedTabs) {
    for (const tab of browserContext.selectedTabs) tabIdSet.add(tab.id)
  }
  if (browserContext.tabs) {
    for (const tab of browserContext.tabs) tabIdSet.add(tab.id)
  }

  if (tabIdSet.size === 0) return browserContext

  const [tabToPage, livePageIds] = await Promise.all([
    browser.resolveTabIds([...tabIdSet]),
    browser.listPages().then((pages) => new Set(pages.map((p) => p.pageId))),
  ])

  const addPageId = (tab: {
    id: number
    url?: string
    title?: string
  }): {
    id: number
    url?: string
    title?: string
    pageId: number | undefined
  } => {
    const resolvedPageId = tabToPage.get(tab.id)
    if (resolvedPageId === undefined) {
      logger.warn('Could not resolve page ID for tab', { tabId: tab.id })
      return { ...tab, pageId: undefined }
    }
    if (!livePageIds.has(resolvedPageId)) {
      logger.warn('Resolved page ID is stale', {
        tabId: tab.id,
        pageId: resolvedPageId,
      })
      return { ...tab, pageId: undefined }
    }
    return { ...tab, pageId: resolvedPageId }
  }

  logger.debug('Resolved tab IDs to page IDs', {
    mapping: Object.fromEntries(tabToPage),
    livePageIds: [...livePageIds],
  })

  const patchCollection = <T extends { id: number }>(
    items: T[] | undefined,
  ): (T & { pageId?: number })[] | undefined => {
    if (!items?.length) return undefined
    const kept = items.map(addPageId).filter((t) => t.pageId !== undefined)
    if (kept.length === 0) return undefined
    return kept as (T & { pageId?: number })[]
  }

  const activeTab = browserContext.activeTab
    ? (addPageId(
        browserContext.activeTab,
      ) as typeof browserContext.activeTab & {
        pageId?: number
      })
    : undefined
  const selectedTabs = patchCollection(browserContext.selectedTabs)
  const tabs = patchCollection(browserContext.tabs)

  // If every tab is stale, open a fresh blank page so the agent has a live context.
  const recovered =
    !activeTab?.pageId && !selectedTabs?.length && !tabs?.length
      ? await recoverBrowserContext(browser, tabIdSet)
      : {
          ...browserContext,
          activeTab,
          selectedTabs,
          tabs,
        }

  return recovered
}

async function recoverBrowserContext(
  browser: Pick<Browser, 'newPage' | 'listPages'>,
  requestedTabIds: Set<number>,
): Promise<BrowserContext> {
  let pageId: number
  try {
    pageId = await browser.newPage('about:blank', { background: true })
  } catch (error) {
    logger.warn(
      'Failed to create a new page for stale browser context recovery',
      {
        requestedTabIds: [...requestedTabIds],
        error: error instanceof Error ? error.message : String(error),
      },
    )
    return { activeTab: undefined, selectedTabs: undefined, tabs: undefined }
  }
  const page = (await browser.listPages()).find((p) => p.pageId === pageId)
  logger.info('Recovered stale browser context via new blank page', {
    pageId,
    url: page?.url,
    requestedTabIds: [...requestedTabIds],
  })
  return {
    activeTab: {
      id: pageId,
      pageId,
      url: 'about:blank',
      title: 'Recovered',
    },
  }
}
