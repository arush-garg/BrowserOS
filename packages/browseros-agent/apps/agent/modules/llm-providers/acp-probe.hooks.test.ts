import { describe, expect, it } from 'bun:test'
import { isAcpProbeEnabled, resolveAcpAgentType } from './acp-probe.hooks'

describe('resolveAcpAgentType', () => {
  it('maps claude-code to the claude ACP type', () => {
    expect(resolveAcpAgentType({ providerType: 'claude-code' })).toBe('claude')
  })

  it('maps codex to the codex ACP type', () => {
    expect(resolveAcpAgentType({ providerType: 'codex' })).toBe('codex')
  })

  it('maps acp-custom to the custom ACP type', () => {
    expect(resolveAcpAgentType({ providerType: 'acp-custom' })).toBe('custom')
  })

  it('honours an explicit acpAgentType override over the provider mapping', () => {
    expect(
      resolveAcpAgentType({
        providerType: 'claude-code',
        acpAgentType: 'custom',
      }),
    ).toBe('custom')
  })

  it('returns undefined for a non-ACP provider', () => {
    expect(resolveAcpAgentType({ providerType: 'openai' })).toBeUndefined()
  })

  it('returns undefined when providerType is missing', () => {
    expect(resolveAcpAgentType({ providerType: undefined })).toBeUndefined()
  })
})

describe('isAcpProbeEnabled', () => {
  const URL = 'http://127.0.0.1:9000'

  it('disables when no ACP type resolved', () => {
    expect(isAcpProbeEnabled({ providerType: undefined }, URL, undefined)).toBe(
      false,
    )
  })

  it('disables when the agent server URL is missing', () => {
    expect(
      isAcpProbeEnabled({ providerType: 'claude-code' }, undefined, 'claude'),
    ).toBe(false)
  })

  it('disables when explicit enabled flag is false', () => {
    expect(
      isAcpProbeEnabled(
        { providerType: 'claude-code', enabled: false },
        URL,
        'claude',
      ),
    ).toBe(false)
  })

  it('enables for built-in claude-code', () => {
    expect(
      isAcpProbeEnabled({ providerType: 'claude-code' }, URL, 'claude'),
    ).toBe(true)
  })

  it('enables for built-in codex', () => {
    expect(isAcpProbeEnabled({ providerType: 'codex' }, URL, 'codex')).toBe(
      true,
    )
  })

  it('disables for a custom agent without a command', () => {
    expect(
      isAcpProbeEnabled({ providerType: 'acp-custom' }, URL, 'custom'),
    ).toBe(false)
  })

  it('enables for a custom agent with its command', () => {
    expect(
      isAcpProbeEnabled(
        { providerType: 'acp-custom', command: 'my-bin acp' },
        URL,
        'custom',
      ),
    ).toBe(true)
  })
})
