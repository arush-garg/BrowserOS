import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { CdpBackend } from '../../src/browser/backends/types'
import { Browser } from '../../src/browser/browser'

/**
 * Creates a mock CdpBackend sufficient for Browser.newPage() and auto-grouping.
 *
 * The Browser constructor needs:
 * - onSessionEvent (for ConsoleCollector)
 * - Target.on (for setupEventHandlers)
 *
 * newPage() needs:
 * - Browser.createTab, Browser.getTabInfo
 * - Browser.getTabs (for listPages called in resolveWindowIdForNewPage)
 * - Browser.getWindows, Browser.createWindow (for hidden tabs)
 *
 * Auto-grouping (groupTabs) needs:
 * - Browser.createTabGroup (returns { group: TabGroup })
 * - Browser.addTabsToGroup (returns { group: TabGroup })
 */
function createMockCdp(overrides?: Partial<CdpBackend>): CdpBackend {
  let tabIdCounter = 100
  // Track created tabs so getTabs returns them (listPages uses getTabs to sync)
  const createdTabs: Array<{
    tabId: number
    targetId: string
    url: string
    title: string
    isActive: boolean
    isLoading: boolean
    loadProgress: number
    isPinned: boolean
    isHidden: boolean
    windowId: number
    index: number
    groupId: string | undefined
  }> = []

  const mockCdp = {
    // ── ProtocolApi.Browser ──
    Browser: {
      createTab: mock(async () => {
        const tabId = tabIdCounter++
        const tab = {
          tabId,
          targetId: `target-${tabId}`,
          url: 'about:blank',
          title: '',
          isActive: false,
          isLoading: false,
          loadProgress: 1,
          isPinned: false,
          isHidden: false,
          windowId: 1,
          index: 1,
          groupId: undefined as string | undefined,
        }
        createdTabs.push(tab)
        return { tab }
      }),
      getTabInfo: mock(async (params: { tabId: number }) => {
        const tabId = params.tabId
        const existing = createdTabs.find((t) => t.tabId === tabId)
        return {
          tab: existing ?? {
            tabId,
            targetId: `target-${tabId}`,
            url: 'https://example.com',
            title: 'Example',
            isActive: false,
            isLoading: false,
            loadProgress: 1,
            isPinned: false,
            isHidden: false,
            windowId: 1,
            index: 1,
            groupId: undefined,
          },
        }
      }),
      getTabs: mock(async () => ({ tabs: [...createdTabs] })),
      getWindows: mock(async () => ({ windows: [] })),
      createWindow: mock(async () => ({
        window: {
          windowId: 99,
          windowType: 'normal',
          bounds: {},
          isActive: true,
          isVisible: false,
          tabCount: 0,
        },
      })),
      createTabGroup: mock(
        async (params: { tabIds: number[]; title?: string }) => ({
          group: {
            groupId: 'group-42',
            windowId: 1,
            title: params.title ?? '',
            color: 'grey',
            collapsed: false,
            tabIds: params.tabIds,
          },
        }),
      ),
      addTabsToGroup: mock(
        async (params: { groupId: string; tabIds: number[] }) => ({
          group: {
            groupId: params.groupId,
            windowId: 1,
            title: '',
            color: 'grey',
            collapsed: false,
            tabIds: params.tabIds,
          },
        }),
      ),
    },

    // ── ProtocolApi.Target ──
    Target: {
      on: mock(() => () => {}),
      attachToTarget: mock(async () => ({ sessionId: 'session-1' })),
    },

    // ── CdpBackend ──
    isConnected: () => true,
    connectionEpoch: () => 0,
    onSessionEvent: mock(() => () => {}),
    session: mock(() => ({})),
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    getTargets: mock(async () => []),

    ...overrides,
  } as unknown as CdpBackend

  return mockCdp
}

describe('newPage auto-grouping', () => {
  let browser: Browser
  let mockCdp: CdpBackend

  beforeEach(() => {
    mockCdp = createMockCdp()
    browser = new Browser(mockCdp)
  })

  it('does not auto-group when originPageId is not provided', async () => {
    const pageId = await browser.newPage('https://example.com')

    // nextPageId starts at 1
    expect(pageId).toBe(1)
    expect(mockCdp.Browser.createTabGroup).not.toHaveBeenCalled()
    expect(mockCdp.Browser.addTabsToGroup).not.toHaveBeenCalled()
  })

  it('does not auto-group when the tab is hidden', async () => {
    const pageId = await browser.newPage('https://example.com', {
      hidden: true,
      originPageId: 1,
    })

    expect(pageId).toBe(1)
    expect(mockCdp.Browser.createTabGroup).not.toHaveBeenCalled()
    expect(mockCdp.Browser.addTabsToGroup).not.toHaveBeenCalled()
  })

  it('does not auto-group when originPageId does not exist', async () => {
    const pageId = await browser.newPage('https://example.com', {
      originPageId: 999,
    })

    expect(pageId).toBe(1)
    expect(mockCdp.Browser.createTabGroup).not.toHaveBeenCalled()
    expect(mockCdp.Browser.addTabsToGroup).not.toHaveBeenCalled()
  })

  it('creates a new tab group when origin tab has no groupId', async () => {
    // First, create the origin page
    const originPageId = await browser.newPage('https://origin.com')

    // Then create a new page with originPageId
    const newPageId = await browser.newPage('https://new.com', {
      originPageId,
    })

    expect(newPageId).toBe(2)
    // Should call createTabGroup (origin had no groupId)
    expect(mockCdp.Browser.createTabGroup).toHaveBeenCalledTimes(1)
    // addTabsToGroup should NOT be called (we use createTabGroup instead)
    expect(mockCdp.Browser.addTabsToGroup).not.toHaveBeenCalled()
  })

  it('adds to existing tab group when origin tab already has a groupId', async () => {
    // Create origin page
    const originPageId = await browser.newPage('https://origin.com')

    // Use getPageInfo to access the page and set a groupId on it
    const originPage = browser.getPageInfo(originPageId)
    expect(originPage).not.toBeNull()
    if (originPage) {
      ;(originPage as { groupId?: string }).groupId = 'existing-group'
    }

    // Create a new page with originPageId
    const newPageId = await browser.newPage('https://new.com', {
      originPageId,
    })

    expect(newPageId).toBe(2)
    // Should NOT call createTabGroup (group already exists)
    expect(mockCdp.Browser.createTabGroup).not.toHaveBeenCalled()
    // Should call addTabsToGroup with the existing groupId
    expect(mockCdp.Browser.addTabsToGroup).toHaveBeenCalledTimes(1)
  })

  it('does not fail tab creation when grouping throws', async () => {
    // Make createTabGroup throw
    ;(
      mockCdp.Browser as unknown as { createTabGroup: () => Promise<never> }
    ).createTabGroup = mock(async () => {
      throw new Error('Grouping failed')
    })

    const originPageId = await browser.newPage('https://origin.com')

    // Should not throw despite grouping failure
    const newPageId = await browser.newPage('https://new.com', {
      originPageId,
    })

    expect(newPageId).toBe(2)
  })
})
