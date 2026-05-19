import { describe, expect, it } from 'bun:test'
import { BrowserOSAdapter } from './adapter'
import {
  CAPABILITIES_READ_TIMEOUT_MS,
  Capabilities,
  resolveStaticFeatureSupport,
} from './capabilities'

describe('resolveStaticFeatureSupport', () => {
  it('enables alpha-gated features automatically in development', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: true,
        alphaFeaturesEnabled: false,
        requiresAlphaFlag: true,
      }),
    ).toBe(true)
  })

  it('enables alpha-gated features only when explicitly opted in', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: false,
        alphaFeaturesEnabled: true,
        requiresAlphaFlag: true,
      }),
    ).toBe(true)
  })

  it('keeps non-alpha features enabled in development', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: true,
        alphaFeaturesEnabled: false,
      }),
    ).toBe(true)
  })

  it('leaves non-alpha features unresolved in production', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: false,
        alphaFeaturesEnabled: false,
      }),
    ).toBeNull()
  })
})

describe('Capabilities initialization', () => {
  it('falls back when BrowserOS capability reads never resolve', async () => {
    const originalGetInstance = BrowserOSAdapter.getInstance
    BrowserOSAdapter.getInstance = () =>
      ({
        getBrowserosVersion: () => new Promise<string>(() => {}),
        getPref: () => new Promise(() => {}),
      }) as unknown as BrowserOSAdapter

    try {
      Capabilities.reset()
      const start = Date.now()
      await expect(Capabilities.getBrowserOSVersion()).resolves.toBeNull()
      await expect(Capabilities.getServerVersion()).resolves.toBeNull()
      expect(Date.now() - start).toBeLessThan(CAPABILITIES_READ_TIMEOUT_MS * 2)
    } finally {
      Capabilities.reset()
      BrowserOSAdapter.getInstance = originalGetInstance
    }
  })
})
