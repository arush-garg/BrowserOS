import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { type ComponentProps, createElement, type FC } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type MockButtonProps = ComponentProps<'button'> & {
  variant?: string
  size?: string
}

mock.module('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: MockButtonProps) =>
    createElement('button', { type: 'button', ...props }, children),
}))

mock.module('@/components/ui/collapsible', () => ({
  Collapsible: ({
    children,
    open: _open,
    onOpenChange: _onOpenChange,
    ...props
  }: ComponentProps<'div'> & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => createElement('div', props, children),
  CollapsibleTrigger: ({ children, ...props }: ComponentProps<'button'>) =>
    createElement('button', { type: 'button', ...props }, children),
  CollapsibleContent: ({ children, ...props }: ComponentProps<'div'>) =>
    createElement('div', props, children),
}))

let ChatError: FC<{
  error: Error
  onRetry?: () => void
  providerType?: string
}>

beforeAll(async () => {
  ChatError = (await import('./ChatError')).ChatError
})

function renderError(error: Error, providerType = 'browseros') {
  return renderToStaticMarkup(
    createElement(ChatError, {
      error,
      onRetry: () => {},
      providerType,
    }),
  )
}

describe('ChatError', () => {
  it('shows retry for connection errors', () => {
    const html = renderError(new Error('Failed to fetch'))

    expect(html).toContain('Try again')
  })

  it('hides retry for credits-exhausted errors', () => {
    const html = renderError(new Error('CREDITS_EXHAUSTED'))

    expect(html).toContain('Daily credits exhausted')
    expect(html).not.toContain('Try again')
  })

  it('hides retry for BrowserOS daily-limit errors', () => {
    const html = renderError(
      new Error('BrowserOS LLM daily limit reached for today'),
    )

    expect(html).toContain('Add your own API key')
    expect(html).not.toContain('Try again')
  })

  it('exposes full error name and message under Show error details', () => {
    const html = renderError(new Error('Boom: something exploded'))

    expect(html).toContain('Show error details')
    expect(html).toContain('name: Error')
    expect(html).toContain('message: Boom: something exploded')
    expect(html).toContain('provider: browseros')
  })

  it('includes stack trace when Error has one', () => {
    const err = new Error('with-stack')
    err.stack = 'Error: with-stack\n    at <anonymous>:1:1'
    const html = renderError(err)

    expect(html).toContain('stack:')
    expect(html).toContain('Error: with-stack')
    expect(html).toContain('&lt;anonymous&gt;:1:1')
  })
})
