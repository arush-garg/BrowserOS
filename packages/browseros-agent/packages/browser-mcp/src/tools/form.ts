import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import { wrapUntrusted } from './trust-boundary'

const inspectExpression = `(() => {
  const controls = [...document.querySelectorAll('input, textarea, select, [role="combobox"]')];
  return controls.map((el, index) => {
    const id = el.id || '';
    const label = (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')?.textContent)
      || el.getAttribute('aria-label')
      || el.getAttribute('name')
      || el.getAttribute('placeholder')
      || '';
    const options = el instanceof HTMLSelectElement
      ? [...el.options].map(o => ({label:o.text, value:o.value, selected:o.selected}))
      : el.getAttribute('role') === 'combobox'
        ? [...document.querySelectorAll('[role="option"]')].map(o => ({label:(o.textContent||'').trim(), selected:o.getAttribute('aria-selected') === 'true'}))
        : [];
    return {
      index, id, name:el.getAttribute('name'), label:label.trim(), role:el.getAttribute('role'),
      type:el.getAttribute('type') || el.tagName.toLowerCase(), required:el.required || el.getAttribute('aria-required') === 'true',
      disabled:el.disabled || el.getAttribute('aria-disabled') === 'true', value:el.value ?? el.getAttribute('aria-valuetext') ?? '',
      invalid:el.getAttribute('aria-invalid'), options
    };
  });
})()`

export const inspect_form = defineTool({
  name: 'inspect_form',
  description:
    'Inspect form controls as structured data: labels, types, required state, values, options, and validation state.',
  input: z.object({ page: z.number().int() }).strict(),
  annotations: { title: 'Inspect form controls', readOnlyHint: true },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const result = await session.Runtime.evaluate({
      expression: inspectExpression,
      returnByValue: true,
    })
    if (result.exceptionDetails)
      return errorResult(`inspect_form: ${result.exceptionDetails.text}`)
    const controls = (result.result?.value as unknown[]) ?? []
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    return textResult(
      wrapUntrusted(JSON.stringify(controls, null, 2), origin),
      { page: args.page, controls, count: controls.length },
    )
  },
})

export const fill_form = defineTool({
  name: 'fill_form',
  description:
    'Fill several form controls by exact label/name/id. Handles native selects and custom ARIA comboboxes, then verifies resulting values.',
  input: z
    .object({
      page: z.number().int(),
      fields: z
        .array(
          z.object({ label: z.string().min(1), value: z.string() }).strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  annotations: { title: 'Fill structured form', destructiveHint: true },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const expression = `(() => {
      const wanted = ${JSON.stringify(args.fields)};
      const results = [];
      const controls = [...document.querySelectorAll('input, textarea, select, [role="combobox"]')];
      const fire = el => { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
      for (const field of wanted) {
        const key = field.label.trim().toLowerCase();
        const el = controls.find(el => {
          const id=el.id||''; const label=(id&&document.querySelector('label[for="'+CSS.escape(id)+'"]')?.textContent)||el.getAttribute('aria-label')||el.getAttribute('name')||el.getAttribute('placeholder')||'';
          return [id,el.getAttribute('name')||'',label].some(v=>v.trim().toLowerCase()===key);
        });
        if (!el) { results.push({label:field.label, ok:false, error:'not found'}); continue; }
        if (el instanceof HTMLSelectElement) { el.value=field.value; fire(el); results.push({label:field.label,ok:el.value===field.value,value:el.value}); continue; }
        if (el.getAttribute('role')==='combobox') {
          el.click();
          const option=[...document.querySelectorAll('[role="option"]')].find(o=>(o.textContent||'').trim().toLowerCase()===field.value.trim().toLowerCase());
          if (option) { option.click(); results.push({label:field.label,ok:true,value:field.value,customCombobox:true}); }
          else results.push({label:field.label,ok:false,error:'option not found',customCombobox:true});
          continue;
        }
        const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set; setter ? setter.call(el,field.value) : (el.value=field.value); fire(el);
        results.push({label:field.label,ok:el.value===field.value,value:el.value});
      }
      return results;
    })()`
    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails)
      return errorResult(`fill_form: ${result.exceptionDetails.text}`)
    const fields = (result.result?.value as Array<{ ok: boolean }>) ?? []
    return textResult(JSON.stringify(fields, null, 2), {
      page: args.page,
      fields,
      ok: fields.every((field) => field.ok),
    })
  },
})
