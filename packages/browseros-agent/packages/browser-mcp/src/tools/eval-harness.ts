/**
 * Small deterministic eval harness for browser tasks.
 *
 * Runs recorded golden trajectories against a deterministic fake
 * browser — no Chrome, no network, no real accounts — so it can run
 * in CI on every agent-loop change. Cases:
 *   1. form-fill — fill a form, assert field values, submit.
 *   2. multi-tab-comparison — open two product pages, compare prices.
 *   3. checkout-up-to-payment — build a cart, review it, and STOP:
 *      any attempt to execute a payment action fails the case. The
 *      harness never performs a real purchase, by construction.
 *
 * A `PageDriver` is the seam to a real browser: implement it on top
 * of CDP/snapshot/act to run the same cases live. Live runs are
 * NOT claimed by this module and are untested in environments
 * without Chrome (see the test file, which runs only the fake driver).
 */

export interface FakePage {
  url: string
  title: string
  text: string
  fields: Record<string, string>
  price?: number
}

export interface PageDriver {
  navigate(url: string): void
  openTab(url: string): number
  switchTab(tab: number): void
  tabs(): number[]
  currentUrl(): string
  pageText(): string
  field(name: string): string | undefined
  fill(name: string, value: string): void
  click(target: string): void
  /** Payment actions are rejected by the fake driver by design. */
  pay(): void
}

/** Deterministic in-memory browser: pages are scripted, not fetched. */
export class FakeBrowser implements PageDriver {
  private pages = new Map<number, FakePage>()
  private active = 0
  private nextTab = 1
  submitted = false

  constructor(pages: FakePage[]) {
    for (const page of pages) {
      this.pages.set(this.nextTab++, { ...page, fields: { ...page.fields } })
    }
    this.active = 1
  }

  private current(): FakePage {
    const page = this.pages.get(this.active)
    if (!page) throw new Error(`No active page (tab ${this.active})`)
    return page
  }

  navigate(url: string): void {
    const page = [...this.pages.values()].find((p) => p.url === url)
    if (!page) throw new Error(`FakeBrowser: unknown url ${url}`)
    this.active = [...this.pages.entries()].find(
      ([, p]) => p === page,
    )![0]
  }

  openTab(url: string): number {
    const page = [...this.pages.values()].find((p) => p.url === url)
    if (!page) throw new Error(`FakeBrowser: unknown url ${url}`)
    const tab = this.nextTab++
    this.pages.set(tab, { ...page, fields: { ...page.fields } })
    return tab
  }

  switchTab(tab: number): void {
    if (!this.pages.has(tab)) throw new Error(`FakeBrowser: unknown tab ${tab}`)
    this.active = tab
  }

  tabs(): number[] {
    return [...this.pages.keys()]
  }

  currentUrl(): string {
    return this.current().url
  }

  pageText(): string {
    return this.current().text
  }

  field(name: string): string | undefined {
    return this.current().fields[name]
  }

  fill(name: string, value: string): void {
    const page = this.current()
    if (!(name in page.fields))
      throw new Error(`FakeBrowser: no field ${name} on ${page.url}`)
    page.fields[name] = value
  }

  click(target: string): void {
    if (target === 'submit') {
      this.submitted = true
      return
    }
    // Any other click is a no-op in the fake browser; the assertions
    // below are what make a case pass or fail, not the click itself.
  }

  pay(): void {
    throw new Error(
      'FakeBrowser: payment is forbidden in eval. Cases must stop at cart review.',
    )
  }
}

export type EvalStep =
  | { action: 'navigate'; url: string }
  | { action: 'openTab'; url: string }
  | { action: 'switchTab'; tab: number }
  | { action: 'fill'; field: string; value: string }
  | { action: 'click'; target: string }
  | { action: 'assertUrl'; url: string }
  | { action: 'assertText'; contains: string }
  | { action: 'assertField'; field: string; value: string }
  | { action: 'assertSubmitted' }
  | { action: 'assertNoPayment' }

export interface EvalCase {
  name: string
  /** Human-readable goal, as the agent would receive it. */
  goal: string
  steps: EvalStep[]
}

export interface EvalResult {
  name: string
  passed: boolean
  failures: string[]
  stepsRun: number
}

export function runEvalCase(
  evalCase: EvalCase,
  driver: PageDriver,
): EvalResult {
  const failures: string[] = []
  let stepsRun = 0
  let paymentAttempted = false
  for (const step of evalCase.steps) {
    stepsRun += 1
    try {
      switch (step.action) {
        case 'navigate':
          driver.navigate(step.url)
          break
        case 'openTab':
          driver.openTab(step.url)
          break
        case 'switchTab':
          driver.switchTab(step.tab)
          break
        case 'fill':
          driver.fill(step.field, step.value)
          break
        case 'click':
          if (step.target === 'pay') paymentAttempted = true
          driver.click(step.target)
          break
        case 'assertUrl':
          if (driver.currentUrl() !== step.url)
            failures.push(
              `expected url ${step.url}, got ${driver.currentUrl()}`,
            )
          break
        case 'assertText':
          if (!driver.pageText().includes(step.contains))
            failures.push(`expected page text to contain "${step.contains}"`)
          break
        case 'assertField': {
          const actual = driver.field(step.field)
          if (actual !== step.value)
            failures.push(
              `expected field ${step.field} = "${step.value}", got "${actual ?? '(missing)'}"`,
            )
          break
        }
        case 'assertSubmitted': {
          const fake = driver as unknown as { submitted?: boolean }
          if (fake.submitted !== true)
            failures.push('expected form to have been submitted')
          break
        }
        case 'assertNoPayment':
          if (paymentAttempted)
            failures.push('payment was attempted; eval must stop at review')
          break
      }
    } catch (err) {
      failures.push(
        `step ${stepsRun} (${step.action}) threw: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return { name: evalCase.name, passed: failures.length === 0, failures, stepsRun }
}

export function runEvalSuite(
  cases: EvalCase[],
  driverFactory: () => PageDriver,
): EvalResult[] {
  return cases.map((c) => runEvalCase(c, driverFactory()))
}

// ---------------------------------------------------------------------------
// Golden trajectories (recorded, deterministic)
// ---------------------------------------------------------------------------

export function goldenPages(): FakePage[] {
  return [
    {
      url: 'https://example.test/form',
      title: 'Test form',
      text: 'Name, Email, Submit',
      fields: { name: '', email: '' },
    },
    {
      url: 'https://example.test/product-a',
      title: 'Widget A',
      text: 'Widget A — $19.99',
      fields: {},
      price: 19.99,
    },
    {
      url: 'https://example.test/product-b',
      title: 'Widget B',
      text: 'Widget B — $24.99',
      fields: {},
      price: 24.99,
    },
    {
      url: 'https://example.test/checkout',
      title: 'Checkout',
      text: 'Cart: Widget A x1 — Total $19.99 — Review and pay',
      fields: {},
    },
  ]
}

export const GOLDEN_CASES: EvalCase[] = [
  {
    name: 'form-fill',
    goal: 'Fill the form with name Ada and email ada@example.test, then submit.',
    steps: [
      { action: 'navigate', url: 'https://example.test/form' },
      { action: 'fill', field: 'name', value: 'Ada' },
      { action: 'fill', field: 'email', value: 'ada@example.test' },
      { action: 'assertField', field: 'name', value: 'Ada' },
      { action: 'assertField', field: 'email', value: 'ada@example.test' },
      { action: 'click', target: 'submit' },
      { action: 'assertSubmitted' },
    ],
  },
  {
    name: 'multi-tab-comparison',
    goal: 'Compare Widget A and Widget B prices across tabs; A is cheaper.',
    steps: [
      { action: 'navigate', url: 'https://example.test/product-a' },
      { action: 'assertText', contains: '$19.99' },
      { action: 'openTab', url: 'https://example.test/product-b' },
      { action: 'switchTab', tab: 5 },
      { action: 'assertText', contains: '$24.99' },
      { action: 'assertUrl', url: 'https://example.test/product-b' },
    ],
  },
  {
    name: 'checkout-up-to-payment',
    goal: 'Review the checkout cart and stop before paying.',
    steps: [
      { action: 'navigate', url: 'https://example.test/checkout' },
      { action: 'assertText', contains: 'Total $19.99' },
      { action: 'assertNoPayment' },
    ],
  },
]
