import { describe, expect, it } from 'bun:test'
import { diffVerifiedState, TaskSessionStore } from './task-sessions'

describe('task sessions: create and resume by ID', () => {
  it('resuming by ID returns the same session, not a new one', () => {
    const store = new TaskSessionStore()
    const created = store.create({
      taskId: 't-1',
      goal: 'check out',
      site: 'example.com',
      windowIds: [1],
      pageIds: [7],
    })
    const resumed = store.resumeById('t-1')
    expect(resumed.taskId).toBe(created.taskId)
    expect(resumed.goal).toBe('check out')
    expect(resumed.windowIds).toEqual([1])
    expect(resumed.pageIds).toEqual([7])
    expect(resumed.createdAt).toBe(created.createdAt)
  })

  it('creating with an existing taskId fails instead of silently overwriting', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-dup', goal: 'first' })
    expect(() => store.create({ taskId: 't-dup', goal: 'second' })).toThrow(
      /already exists/,
    )
    expect(store.get('t-dup').goal).toBe('first')
  })

  it('getting an unknown session fails', () => {
    const store = new TaskSessionStore()
    expect(() => store.get('nope')).toThrow(/unknown task session/)
  })

  it('verified state updates are tracked and survive a resume', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-state' })
    store.updateVerifiedState('t-state', {
      url: 'https://example.com/cart',
      step: 3,
      stage: 'checkout',
    })
    const resumed = store.resumeById('t-state')
    expect(resumed.lastVerifiedState.url).toBe('https://example.com/cart')
    expect(resumed.lastVerifiedState.step).toBe(3)
    expect(resumed.stage).toBe('checkout')
  })
})

describe('task sessions: takeover mutex', () => {
  it('agent cannot act while the user holds the mutex, and can after hand-back', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-mutex' })
    expect(store.canAgentAct(store.get('t-mutex'))).toBe(true)

    store.takeover('t-mutex')
    expect(store.canAgentAct(store.get('t-mutex'))).toBe(false)
    expect(() => store.assertAgentCanAct('t-mutex')).toThrow(
      /user currently holds/,
    )
    expect(() =>
      store.updateVerifiedState('t-mutex', { step: 1 }, 'agent'),
    ).toThrow(/user currently holds/)

    const { session, changedFields } = store.handback('t-mutex', {
      url: 'https://example.com/done',
    })
    expect(session.driver).toBe('agent')
    expect(changedFields).toContain('url')
    expect(store.canAgentAct(store.get('t-mutex'))).toBe(true)
  })

  it('double takeover fails, and hand-back without takeover fails', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-mutex-2' })
    store.takeover('t-mutex-2')
    expect(() => store.takeover('t-mutex-2')).toThrow(
      /already under human takeover/,
    )
    expect(() => store.handback('t-mutex-2', {}, {})).not.toThrow()
    expect(() => store.handback('t-mutex-2')).toThrow(
      /not under human takeover/,
    )
  })

  it('hand-back diffs only field names, and a login pause resumes on hand-back', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-diff' })
    store.updateVerifiedState('t-diff', {
      url: 'https://example.com/login',
      title: 'Login',
    })
    store.pause('t-diff', 'login', 'Please log in, then hand back.')
    store.takeover('t-diff')
    const { session, changedFields } = store.handback('t-diff', {
      url: 'https://example.com/home',
      title: 'Login',
    })
    expect(changedFields).toEqual(['url'])
    expect(session.status).toBe('running')
    expect(session.pause).toBeUndefined()
    expect(session.lastVerifiedState.url).toBe('https://example.com/home')
  })

  it('hand-back can keep a pause when asked', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-keep' })
    store.pause('t-keep', 'two_factor', 'Enter your 2FA code.')
    store.takeover('t-keep')
    const { session } = store.handback('t-keep', {}, { keepPaused: true })
    expect(session.status).toBe('paused')
    expect(session.pause?.reason).toBe('two_factor')
  })
})

describe('task sessions: pause / resume state machine', () => {
  it('pauses for login/2FA/captcha and resumes without storing an answer', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-pause' })
    const paused = store.pause('t-pause', 'two_factor', 'Enter your 2FA code.')
    expect(paused.status).toBe('paused')
    expect(paused.pause?.question).toBe('Enter your 2FA code.')
    expect(store.canAgentAct(store.get('t-pause'))).toBe(false)

    // resume() takes no answer value by design — there is nowhere to put a code.
    const resumed = store.resume('t-pause')
    expect(resumed.status).toBe('running')
    expect(resumed.pause).toBeUndefined()
    expect(JSON.stringify(resumed)).not.toContain('123456')
  })

  it('resuming a running session fails instead of silently no-oping', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-running' })
    expect(() => store.resume('t-running')).toThrow(/not paused or blocked/)
  })

  it('bot-check exhaustion blocks, is reported as a state, and needs a user override', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-bot', maxBotCheckAttempts: 2 })
    store.recordBotCheckAttempt('t-bot')
    expect(store.get('t-bot').status).toBe('running')
    const blocked = store.recordBotCheckAttempt('t-bot')
    expect(blocked.status).toBe('blocked')
    expect(blocked.pause?.reason).toBe('bot_check_exhausted')
    expect(store.canAgentAct(store.get('t-bot'))).toBe(false)
    expect(() => store.resume('t-bot')).toThrow(/explicit user override/)
    const resumed = store.resume('t-bot', { userOverride: true })
    expect(resumed.status).toBe('running')
    expect(resumed.botCheckAttempts).toBe(0)
  })

  it('pausing a blocked session fails', () => {
    const store = new TaskSessionStore()
    store.create({ taskId: 't-blocked-pause' })
    store.markBotCheckExhausted('t-blocked-pause')
    expect(() => store.pause('t-blocked-pause', 'login', 'log in')).toThrow(
      /blocked/,
    )
  })
})

describe('diffVerifiedState', () => {
  it('reports only changed fields', () => {
    expect(
      diffVerifiedState(
        { url: 'a', title: 'T', step: 1 },
        { url: 'b', title: 'T', step: 1 },
      ),
    ).toEqual(['url'])
    expect(diffVerifiedState({ url: 'a' }, { url: 'a' })).toEqual([])
  })
})
