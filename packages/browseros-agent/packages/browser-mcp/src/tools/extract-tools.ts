import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import { wrapUntrusted } from './trust-boundary'

/**
 * First-class reading actions, so an agent does not have to navigate and
 * click just to "see" data, and does not have to dump a whole snapshot to
 * find one element.
 *
 * - `extract`: schema-guided extraction (caller supplies selector +
 *   attribute per field; the page is never asked to free-form describe
 *   itself, and no LLM is involved in the extraction itself).
 * - `search_page`: regex search within page text, optionally scoped to a
 *   CSS subtree, with line numbers.
 * - `find_elements`: selector + attribute query, with refs left to
 *   `snapshot`/`act` (this tool reports position, not refs).
 * - `fill_form_by_ref`: batch fill by snapshot ref, one field at a time,
 *   continuing past a per-field failure and reporting per-field results.
 *   It uses the existing `Input.fill` implementation; it does not change
 *   click/fill execution itself.
 */

const extractFieldSchema = z
  .object({
    name: z.string().min(1).describe('Field name in the returned object.'),
    selector: z.string().min(1).describe('CSS selector for the field.'),
    attribute: z
      .enum(['text', 'href', 'value'])
      .default('text')
      .describe('What to read from each matched element.'),
    multiple: z
      .boolean()
      .default(false)
      .describe('Return all matches instead of only the first.'),
  })
  .strict()

export const extract = defineTool({
  name: 'extract',
  description:
    'Extract structured data from the current page with a caller-supplied schema: each field names a CSS selector and an attribute (text, href, or value). No LLM is involved; unmatched selectors return empty values instead of failing the whole extraction.',
  input: z
    .object({
      page: z.number().int(),
      fields: z.array(extractFieldSchema).min(1).max(50),
    })
    .strict(),
  annotations: { title: 'Extract structured page data', readOnlyHint: true },
  handler: async (args, ctx) => {
    const names = args.fields.map((field) => field.name)
    if (new Set(names).size !== names.length) {
      return errorResult('extract: field names must be unique')
    }
    const { session } = await ctx.session.pages.getSession(args.page)
    const expression = `(() => {
      const fields = ${JSON.stringify(args.fields)};
      return fields.map((field) => {
        const elements = [...document.querySelectorAll(field.selector)];
        const taken = field.multiple ? elements : elements.slice(0, 1);
        const values = taken.map((el) => {
          if (field.attribute === 'href') return typeof el.href === 'string' ? el.href : (el.getAttribute('href') ?? '');
          if (field.attribute === 'value') return 'value' in el ? (el.value ?? '') : '';
          return (el.textContent || '').trim();
        });
        return { name: field.name, values };
      });
    })()`
    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      return errorResult(
        `extract: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      )
    }
    const fields = (result.result?.value as unknown[]) ?? []
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    return textResult(wrapUntrusted(JSON.stringify(fields, null, 2), origin), {
      page: args.page,
      fields,
    })
  },
})

export const search_page = defineTool({
  name: 'search_page',
  description:
    'Search page text with a case-insensitive regular expression, optionally scoped to a CSS subtree. Returns matching lines with line numbers, instead of dumping the whole page.',
  input: z
    .object({
      page: z.number().int(),
      pattern: z.string().min(1).describe('Regular expression.'),
      selector: z
        .string()
        .optional()
        .describe('Restrict the search to a CSS subtree.'),
      limit: z.number().int().min(1).max(500).default(50),
    })
    .strict(),
  annotations: { title: 'Search page text', readOnlyHint: true },
  handler: async (args, ctx) => {
    let regex: RegExp
    try {
      regex = new RegExp(args.pattern, 'i')
    } catch (err) {
      return errorResult(
        `search_page: invalid regex - ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    void regex
    const { session } = await ctx.session.pages.getSession(args.page)
    const expression = `(() => {
      const root = ${args.selector ? `document.querySelector(${JSON.stringify(args.selector)})` : 'document.body'};
      const text = root?.innerText ?? '';
      let matches = [];
      try {
        const pattern = new RegExp(${JSON.stringify(args.pattern)}, 'i');
        matches = text.split('\\n').map((line, index) => ({ line: index + 1, text: line })).filter((entry) => pattern.test(entry.text));
      } catch (error) {
        return { error: String(error) };
      }
      return { matches: matches.slice(0, ${args.limit}) };
    })()`
    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      return errorResult(
        `search_page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      )
    }
    const value = result.result?.value as
      | { error?: string; matches?: Array<{ line: number; text: string }> }
      | undefined
    if (value?.error) return errorResult(`search_page: ${value.error}`)
    const matches = value?.matches ?? []
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    const rendered =
      matches.length > 0
        ? matches.map((match) => `${match.line}: ${match.text}`).join('\n')
        : 'no matches'
    return textResult(wrapUntrusted(rendered, origin), {
      page: args.page,
      pattern: args.pattern,
      count: matches.length,
      matches,
    })
  },
})

const findAttributeSchema = z.enum(['text', 'href', 'value', 'role', 'aria-label'])

export const find_elements = defineTool({
  name: 'find_elements',
  description:
    'Find elements by CSS selector and return the requested attributes for each match (text, href, value, role, aria-label). For locating elements without dumping a snapshot.',
  input: z
    .object({
      page: z.number().int(),
      selector: z.string().min(1).describe('CSS selector.'),
      attributes: z
        .array(findAttributeSchema)
        .min(1)
        .max(5)
        .default(['text'])
        .describe('Attributes to return per element.'),
      limit: z.number().int().min(1).max(200).default(50),
    })
    .strict(),
  annotations: { title: 'Find page elements', readOnlyHint: true },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const expression = `(() => {
      const wanted = ${JSON.stringify(args.attributes)};
      const elements = [...document.querySelectorAll(${JSON.stringify(args.selector)})].slice(0, ${args.limit});
      return elements.map((el, index) => {
        const out = { index };
        if (wanted.includes('text')) out.text = (el.textContent || '').trim();
        if (wanted.includes('href')) out.href = typeof el.href === 'string' ? el.href : (el.getAttribute('href') ?? '');
        if (wanted.includes('value')) out.value = 'value' in el ? (el.value ?? '') : '';
        if (wanted.includes('role')) out.role = el.getAttribute('role') ?? '';
        if (wanted.includes('aria-label')) out['aria-label'] = el.getAttribute('aria-label') ?? '';
        return out;
      });
    })()`
    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      return errorResult(
        `find_elements: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      )
    }
    const elements = (result.result?.value as unknown[]) ?? []
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    return textResult(
      wrapUntrusted(JSON.stringify(elements, null, 2), origin),
      { page: args.page, selector: args.selector, count: elements.length, elements },
    )
  },
})

export const fill_form_by_ref = defineTool({
  name: 'fill_form_by_ref',
  description:
    'Fill several form controls by snapshot ref in one call, verifying per field: a field that fails does not abort the rest, and the result reports each field separately. Uses the existing Input.fill implementation.',
  input: z
    .object({
      page: z.number().int(),
      fields: z
        .array(
          z
            .object({
              ref: z.string().min(1).describe('Snapshot ref, e.g. "e12".'),
              value: z.string(),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  annotations: { title: 'Fill form by ref', destructiveHint: true },
  handler: async (args, ctx) => {
    const input = ctx.session.input(args.page)
    const results: Array<{ ref: string; ok: boolean; error?: string }> = []
    for (const field of args.fields) {
      try {
        await input.fill(field.ref, field.value)
        results.push({ ref: field.ref, ok: true })
      } catch (err) {
        results.push({
          ref: field.ref,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return textResult(JSON.stringify(results, null, 2), {
      page: args.page,
      fields: results,
      ok: results.every((field) => field.ok),
    })
  },
})
