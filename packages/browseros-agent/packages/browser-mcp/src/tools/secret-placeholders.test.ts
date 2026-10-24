import { describe, expect, it } from 'bun:test'
import {
  extractSecretPlaceholders,
  formatSecretPlaceholder,
  hasSecretPlaceholders,
  InMemorySecretVault,
  redactSecrets,
  resolveSecretPlaceholders,
  sanitizeForTranscript,
} from './secret-placeholders'

describe('secret placeholders', () => {
  it('extracts placeholder keys and leaves values out of the placeholder text', () => {
    const text = `type ${formatSecretPlaceholder('login-password')} here`
    expect(extractSecretPlaceholders(text)).toEqual(['login-password'])
    expect(hasSecretPlaceholders(text)).toBe(true)
    expect(text).not.toContain('hunter2')
    expect(extractSecretPlaceholders('plain text')).toEqual([])
  })

  it('resolves only at the fill boundary, per-domain, and fails closed', () => {
    const vault = new InMemorySecretVault()
    vault.set('login-password', 'hunter2', ['example.com'])
    const { text, keysUsed } = resolveSecretPlaceholders(
      `fill ${formatSecretPlaceholder('login-password')}`,
      vault,
      'example.com',
    )
    expect(text).toBe('fill hunter2')
    expect(keysUsed).toEqual(['login-password'])
    // Wrong domain: no value, no partial fill.
    expect(() =>
      resolveSecretPlaceholders(
        formatSecretPlaceholder('login-password'),
        vault,
        'evil.example',
      ),
    ).toThrow(/not allowed for domain/)
    // Unknown key: no placeholder text is typed.
    expect(() =>
      resolveSecretPlaceholders(
        formatSecretPlaceholder('missing-key'),
        vault,
        'example.com',
      ),
    ).toThrow(/no vault value/)
  })

  it('redacts known values back to placeholders for transcripts', () => {
    const secrets = new Map([['login-password', 'hunter2']])
    expect(redactSecrets('typed hunter2 into the form', secrets)).toBe(
      'typed <secret>login-password</secret> into the form',
    )
    expect(sanitizeForTranscript('typed hunter2 into the form', secrets)).toBe(
      'typed <secret>redacted</secret> into the form',
    )
  })

  it('does not corrupt text when a secret value is empty', () => {
    expect(redactSecrets('abc', new Map([['k', '']]))).toBe('abc')
  })
})
