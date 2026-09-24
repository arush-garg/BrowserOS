import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'

export type MouseButton = 'left' | 'middle' | 'right'

export async function dispatchClick(
  session: ProtocolApi,
  x: number,
  y: number,
  button: MouseButton,
  clickCount: number,
  modifiers: number,
): Promise<void> {
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
  await session.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x,
    y,
    button,
    clickCount,
    modifiers,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x,
    y,
    button,
    clickCount,
    modifiers,
  })
}

export async function dispatchHover(
  session: ProtocolApi,
  x: number,
  y: number,
): Promise<void> {
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
}

export async function dispatchScroll(
  session: ProtocolApi,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await session.Input.dispatchMouseEvent({
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  })
}

export async function dispatchDrag(
  session: ProtocolApi,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await session.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: from.x,
    y: from.y,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    clickCount: 1,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: to.x,
    y: to.y,
  })
  await session.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    clickCount: 1,
  })
}

/**
 * Presses the button, runs `hold` while it stays down, then releases — a long-press.
 *
 * `hold` decides how long the press lasts: a fixed delay, or a poll that resolves when
 * some page condition is met. The release is in a `finally` on purpose: a hold that is
 * aborted or throws mid-way would otherwise leave the button logically down for the rest
 * of the page's life, turning every later move into a drag.
 */
export async function dispatchHold(
  session: ProtocolApi,
  x: number,
  y: number,
  button: MouseButton,
  hold: () => Promise<void>,
): Promise<void> {
  await session.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })
  await session.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x,
    y,
    button,
    clickCount: 1,
  })
  try {
    await hold()
  } finally {
    await session.Input.dispatchMouseEvent({
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount: 1,
    })
  }
}
