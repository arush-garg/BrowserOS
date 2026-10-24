import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { extract, fill_form_by_ref, find_elements, search_page } from './extract-tools'

/** Minimal fake DOM element: tag/class/text/href/value/attributes. */
interface FakeElement {
  tag: string
  className: string
  textContent: string
  href?: string
  value?: string
  attributes: Record<string, string>
  getAttribute: (name: string) => string | null
}

function fakeElement(partial: Partial<FakeElement> & { tag: string }): FakeElement {
  const attributes = partial.attributes ?? {}
  return {
    tag: partial.tag,
    className: partial.className ?? '',
    textContent: partial.textContent ?? '',
    href: partial.href,
    value: partial.value,
    attributes,
    getAttribute: (name: string) => attributes[name] ?? null,
  }
}

/** A fake `document` whose querySelector(All) the tool expressions run against. */
function fakeDocument(elements: FakeElement[], bodyText: string) {
  const match = (selector: string) => {
    if (selector === '*') return elements
    if (selector.startsWith('.')) {
      const wanted = selector.slice(1)
      return elements.filter((el) => el.className.split(' ').includes(wanted))
    }
    return elements.filter(
      (el) => el.tag.toLowerCase() === selector.toLowerCase(),
    )
  }
  return {
    body: { innerText: bodyText },
    querySelectorAll: (selector: string) => match(selector),
    querySelector: (selector: string) => match(selector)[0] ?? null,
  }
}

/**
 * Mock session whose Runtime.evaluate actually executes the tool's
 * expression against the fake document, so the expressions themselves —
 * not just handler plumbing — are tested.
 */
function sessionWithDocument(
  elements: FakeElement[],
  bodyText: string,
): BrowserSession {
  const document = fakeDocument(elements, bodyText)
  return {
    pages: {
      getInfo: () => ({ url: 'https://example.com' }),
      getSession: async () => ({
        session: {
          Runtime: {
            evaluate: async ({ expression }: { expression: string }) => {
              try {
                const value = new Function(
                  'document',
                  `return ${expression}`,
                )(document)
                return { result: { value } }
              } catch (error) {
                return {
                  exceptionDetails: {
                    text: error instanceof Error ? error.message : String(error),
                  },
                }
              }
            },
          },
        },
      }),
    },
  } as unknown as BrowserSession
}

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

const elements = [
  fakeElement({ tag: 'h1', textContent: 'Widget Pro' }),
  fakeElement({
    tag: 'a',
    textContent: 'Buy now',
    href: 'https://example.com/buy',
    attributes: { role: 'link' },
  }),
  fakeElement({ tag: 'span', className: 'price', textContent: '$19.99' }),
  fakeElement({ tag: 'span', className: 'price', textContent: '$24.99' }),
  fakeElement({ tag: 'input', value: 'hello', attributes: {} }),
]

describe('extract', () => {
  it('extracts text, href, and multiple values per a caller schema', async () => {
    const result = await executeTool(
      extract,
      {
        page: 1,
        fields: [
          { name: 'title', selector: 'h1', attribute: 'text' },
          { name: 'buy', selector: 'a', attribute: 'href' },
          { name: 'prices', selector: '.price', attribute: 'text', multiple: true },
          { name: 'missing', selector: 'table', attribute: 'text' },
        ],
      },
      { session: sessionWithDocument(elements, 'Widget Pro') },
    )
    expect(result.isError).toBeFalsy()
    const fields = (result.structuredContent as { fields: unknown }).fields
    expect(fields).toEqual([
      { name: 'title', values: ['Widget Pro'] },
      { name: 'buy', values: ['https://example.com/buy'] },
      { name: 'prices', values: ['$19.99', '$24.99'] },
      { name: 'missing', values: [] },
    ])
  })

  it('rejects duplicate field names via schema validation', async () => {
    const result = await executeTool(
      extract,
      {
        page: 1,
        fields: [
          { name: 'title', selector: 'h1' },
          { name: 'title', selector: 'h1' },
        ],
      },
      { session: sessionWithDocument(elements, '') },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('unique')
  })
})

describe('search_page', () => {
  it('returns matching lines with line numbers, scoped or unscoped', async () => {
    const result = await executeTool(
      search_page,
      { page: 1, pattern: 'pro' },
      {
        session: sessionWithDocument(
          elements,
          'Widget Pro\nSomething else\nPro again',
        ),
      },
    )
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ page: 1, count: 2 })
    expect(textOf(result)).toContain('1: Widget Pro')
    expect(textOf(result)).toContain('3: Pro again')
  })

  it('rejects an invalid regex instead of executing it', async () => {
    const result = await executeTool(
      search_page,
      { page: 1, pattern: '([invalid' },
      { session: sessionWithDocument(elements, '') },
    )
    expect(result.isError).toBe(true)
  })
})

describe('find_elements', () => {
  it('returns requested attributes per match', async () => {
    const result = await executeTool(
      find_elements,
      { page: 1, selector: '.price', attributes: ['text'] },
      { session: sessionWithDocument(elements, '') },
    )
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ page: 1, count: 2 })
    const found = (result.structuredContent as { elements: unknown }).elements
    expect(found).toEqual([
      { index: 0, text: '$19.99' },
      { index: 1, text: '$24.99' },
    ])
  })
})

describe('fill_form_by_ref', () => {
  it('fills a batch, continues past a failure, and reports per field', async () => {
    const filled: Array<[string, string]> = []
    const session = {
      input: () => ({
        fill: async (ref: string, value: string) => {
          if (ref === 'e2') throw new Error('unknown ref')
          filled.push([ref, value])
        },
      }),
      pages: {},
    } as unknown as BrowserSession
    const result = await executeTool(
      fill_form_by_ref,
      {
        page: 1,
        fields: [
          { ref: 'e1', value: 'a' },
          { ref: 'e2', value: 'b' },
          { ref: 'e3', value: 'c' },
        ],
      },
      { session },
    )
    expect(result.isError).toBeFalsy()
    expect(filled).toEqual([
      ['e1', 'a'],
      ['e3', 'c'],
    ])
    expect(result.structuredContent).toMatchObject({ ok: false })
    const fields = (result.structuredContent as { fields: Array<{ ref: string; ok: boolean }> }).fields
    expect(fields.map((field) => [field.ref, field.ok])).toEqual([
      ['e1', true],
      ['e2', false],
      ['e3', true],
    ])
  })
})
