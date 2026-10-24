/**
 * Credential-vault placeholders at the execution boundary.
 *
 * Contract:
 * - The model, the agent loop, transcripts, logs, and session history only
 *   ever see a placeholder: `<secret>key</secret>`. The key is an identifier
 *   (e.g. 'login-password', 'totp-code'), never the value.
 * - The real value is substituted *immediately before* a fill action
 *   executes, for one domain only, and is never written back into a
 *   transcript, event, or result. `resolveSecretPlaceholders` returns the
 *   resolved text to the caller that performs the fill — callers must not
 *   log or return that text.
 * - A placeholder scoped to one domain must never be resolved for another
 *   domain. Unresolvable or out-of-scope placeholders fail closed: the
 *   fill does not happen and no placeholder text is typed into a page.
 *
 * This module defines the placeholder format and the resolver interface. It
 * deliberately does NOT implement a production vault (OS keychain / extension
 * secure storage); `InMemorySecretVault` exists for tests and local
 * development only and must not be used to hold real credentials in
 * production. A production vault implements `SecretVault` and is injected
 * at the fill site, not stored in a task session.
 */

export const SECRET_PLACEHOLDER_PATTERN = /<secret>([A-Za-z0-9._-]+)<\/secret>/g

export function formatSecretPlaceholder(key: string): string {
  return `<secret>${key}</secret>`
}

export function extractSecretPlaceholders(text: string): string[] {
  const keys: string[] = []
  for (const match of text.matchAll(SECRET_PLACEHOLDER_PATTERN)) {
    if (match[1] && !keys.includes(match[1])) keys.push(match[1])
  }
  return keys
}

export function hasSecretPlaceholders(text: string): boolean {
  return extractSecretPlaceholders(text).length > 0
}

export interface SecretVault {
  /**
   * Return the value for `key` on `domain`, or undefined if there is none.
   * Implementations must not log the returned value.
   */
  resolve(key: string, domain: string): string | undefined
  /** Domains this key may be used on. Undefined means "no scoping info" — callers must treat that as not allowed unless they explicitly opt in. */
  allowedDomains?(key: string): string[] | undefined
}

export class SecretVaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretVaultError'
  }
}

/**
 * Resolve every placeholder in `text` for `domain`, at the fill boundary.
 * Returns the resolved text plus only the key names used — never values.
 * Throws (fail closed) on an unknown key or a key not allowed for the domain.
 */
export function resolveSecretPlaceholders(
  text: string,
  vault: SecretVault,
  domain: string,
): { text: string; keysUsed: string[] } {
  const keys = extractSecretPlaceholders(text)
  if (keys.length === 0) return { text, keysUsed: [] }
  let resolved = text
  for (const key of keys) {
    const allowed = vault.allowedDomains?.(key)
    if (allowed !== undefined && !allowed.includes(domain)) {
      throw new SecretVaultError(
        `secret placeholder "${key}" is not allowed for domain "${domain}"`,
      )
    }
    const value = vault.resolve(key, domain)
    if (value === undefined || value === '') {
      throw new SecretVaultError(
        `no vault value for secret placeholder "${key}" on domain "${domain}"`,
      )
    }
    resolved = resolved.split(formatSecretPlaceholder(key)).join(value)
  }
  return { text: resolved, keysUsed: keys }
}

/**
 * Replace known secret *values* in `text` with their placeholders, for
 * transcripts and logs. Values are matched longest-first so a value that
 * contains another value is not partially masked. Empty values are skipped
 * (replacing '' would corrupt the text). Anything still matching a value
 * the caller did not supply cannot be masked here — callers must not put
 * raw credential values into text they pass to this function in the first
 * place.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyMap<string, string> | Record<string, string>,
): string {
  const entries = (
    secrets instanceof Map ? [...secrets.entries()] : Object.entries(secrets)
  ).filter(([, value]) => value !== '')
  entries.sort((a, b) => b[1].length - a[1].length)
  let redacted = text
  for (const [key, value] of entries) {
    redacted = redacted.split(value).join(formatSecretPlaceholder(key))
  }
  return redacted
}

/** Replace known secret values with a generic redaction (no key disclosure). */
export function sanitizeForTranscript(
  text: string,
  secrets: ReadonlyMap<string, string> | Record<string, string>,
): string {
  const entries = (
    secrets instanceof Map ? [...secrets.entries()] : Object.entries(secrets)
  ).filter(([, value]) => value !== '')
  entries.sort((a, b) => b[1].length - a[1].length)
  let sanitized = text
  for (const [, value] of entries) {
    sanitized = sanitized.split(value).join('<secret>redacted</secret>')
  }
  return sanitized
}

/** Test / local-dev vault only. Do not use for real credentials in production. */
export class InMemorySecretVault implements SecretVault {
  private readonly values = new Map<string, string>()
  private readonly scopes = new Map<string, string[]>()

  set(key: string, value: string, domains: string[] = []): void {
    this.values.set(key, value)
    this.scopes.set(key, domains)
  }

  resolve(key: string): string | undefined {
    return this.values.get(key)
  }

  allowedDomains(key: string): string[] | undefined {
    return this.scopes.get(key)
  }

  clear(): void {
    this.values.clear()
    this.scopes.clear()
  }
}
