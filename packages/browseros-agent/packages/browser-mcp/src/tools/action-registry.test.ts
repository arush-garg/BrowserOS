import { describe, expect, it } from 'bun:test'
import {
  checkActionPolicy,
  describeActionPolicy,
  filterToolsByPolicy,
} from './action-registry'

describe('checkActionPolicy', () => {
  it('allows everything when no policy is set', () => {
    expect(checkActionPolicy('screenshot', undefined).allowed).toBe(true)
  })

  it('blocks excluded tools regardless of origin', () => {
    const decision = checkActionPolicy('screenshot', {
      excludedTools: ['screenshot'],
    }, 'https://example.com')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('excluded')
  })

  it('blocks origins outside the allowlist and allows listed ones', () => {
    const policy = { allowedOrigins: ['https://example.com'] }
    expect(
      checkActionPolicy('snapshot', policy, 'https://example.com').allowed,
    ).toBe(true)
    expect(
      checkActionPolicy('snapshot', policy, 'https://other.test').allowed,
    ).toBe(false)
    // A bare hostname entry matches the same host.
    expect(
      checkActionPolicy('snapshot', { allowedOrigins: ['example.com'] }, 'https://example.com/page').allowed,
    ).toBe(true)
  })

  it('does not drop tools from a catalog listing when no origin is known', () => {
    const tools = filterToolsByPolicy(['snapshot', 'screenshot'], {
      allowedOrigins: ['https://example.com'],
    })
    expect(tools).toEqual(['snapshot', 'screenshot'])
    expect(
      filterToolsByPolicy(['snapshot', 'screenshot'], {
        excludedTools: ['screenshot'],
      }),
    ).toEqual(['snapshot'])
  })

  it('describes a policy without leaking anything', () => {
    expect(describeActionPolicy(undefined)).toContain('no action policy')
    expect(
      describeActionPolicy({ excludedTools: ['evaluate'] }),
    ).toContain('evaluate')
  })
})
