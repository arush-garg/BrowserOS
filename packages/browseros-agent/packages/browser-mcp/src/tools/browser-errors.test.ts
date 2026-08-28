import { describe, expect, it } from 'bun:test'
import { classifyBrowserError } from './browser-errors'

describe('classifyBrowserError', () => {
  it('classifies stale refs errors', () => {
    const result = classifyBrowserError(
      new Error('element detached from document'),
    )
    expect(result?.code).toBe('stale_refs')
    expect(result?.recovery).toBe('snapshot_then_retry')
    expect(result?.status).toBe(422)
  })

  it('classifies tab destroyed errors', () => {
    const result = classifyBrowserError(new Error('Target closed'))
    expect(result?.code).toBe('tab_destroyed')
    expect(result?.recovery).toBe('create_new_tab')
  })

  it('classifies navigation race errors', () => {
    const result = classifyBrowserError(
      new Error('Navigating frame was detached'),
    )
    expect(result?.code).toBe('navigation_race')
    expect(result?.recovery).toBe('snapshot_then_retry')
  })

  it('classifies session expired errors', () => {
    const result = classifyBrowserError(
      new Error('Execution context was destroyed'),
    )
    expect(result?.code).toBe('session_expired')
    expect(result?.recovery).toBe('retry')
  })

  it('classifies timeout errors', () => {
    const result = classifyBrowserError(
      new Error('Timeout waiting for selector'),
    )
    expect(result?.code).toBe('timeout')
    expect(result?.recovery).toBe('retry')
  })

  it('returns null for non-browser errors', () => {
    expect(
      classifyBrowserError(new Error('SyntaxError: unexpected token')),
    ).toBeNull()
    expect(classifyBrowserError('string error')).toBeNull()
    expect(classifyBrowserError(null)).toBeNull()
  })
})
