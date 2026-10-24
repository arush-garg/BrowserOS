import { describe, expect, test } from 'bun:test'
import { condenseTranscript, type TranscriptMessage } from './condenser'

function msg(role: string, content: string): TranscriptMessage {
  return { role, content }
}

describe('condenseTranscript', () => {
  test('below threshold: returns the transcript unchanged, uncondensed', async () => {
    const messages = [
      msg('system', 'You are a browser agent.'),
      msg('user', 'Book a flight.'),
      msg('assistant', 'Searching.'),
    ]
    const result = await condenseTranscript(messages, { thresholdTokens: 10_000 })
    expect(result.condensed).toBe(false)
    expect(result.messages).toEqual(messages)
    expect(result.summary).toBeUndefined()
  })

  test('above token threshold: keeps head + tail verbatim, summarizes the middle', async () => {
    const messages = [
      msg('system', 'You are a browser agent. Goal: book a flight.'),
      msg('user', 'Step one happened.'),
      msg('assistant', 'Step two happened.'),
      msg('user', 'Step three happened.'),
      msg('assistant', 'Step four happened.'),
      msg('user', 'What is the current state?'),
    ]
    const result = await condenseTranscript(messages, {
      thresholdTokens: 1,
      keepHead: 1,
      keepTail: 1,
      summarizer: (middle) => `cheap-summary of ${middle.length} messages`,
    })
    expect(result.condensed).toBe(true)
    expect(result.summary).toBe('cheap-summary of 4 messages')
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0]).toEqual(messages[0])
    expect(result.messages[2]).toEqual(messages[5])
    expect(result.messages[1].role).toBe('system')
    expect(result.messages[1].content).toContain('cheap-summary of 4 messages')
  })

  test('above message-count threshold: condenses even when tokens are under budget', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg('user', `m${i}`),
    )
    const result = await condenseTranscript(messages, {
      thresholdTokens: 10_000,
      maxMessages: 5,
      keepHead: 1,
      keepTail: 2,
    })
    expect(result.condensed).toBe(true)
    expect(result.messages).toHaveLength(4) // head + summary + tail
    expect(result.messages[0]).toEqual(messages[0])
    expect(result.messages[3]).toEqual(messages[9])
  })

  test('default summarizer is deterministic and needs no model', async () => {
    const messages = [
      msg('system', 'Goal.'),
      msg('user', 'First middle message.'),
      msg('assistant', 'Second middle message.'),
      msg('user', 'Tail.'),
    ]
    const result = await condenseTranscript(messages, {
      thresholdTokens: 1,
      keepHead: 1,
      keepTail: 1,
    })
    expect(result.condensed).toBe(true)
    expect(result.summary).toContain('Summary of 2 earlier messages')
    expect(result.summary).toContain('First middle message')
  })

  test('too-short transcript: nothing to summarize, so no condensation', async () => {
    const messages = [msg('system', 'Goal.'), msg('user', 'Tail.')]
    const result = await condenseTranscript(messages, {
      thresholdTokens: 1,
      keepHead: 1,
      keepTail: 1,
    })
    expect(result.condensed).toBe(false)
    expect(result.messages).toEqual(messages)
  })

  test('injected token estimator is honored', async () => {
    const messages = [msg('system', 'Goal.'), msg('user', 'a'), msg('user', 'b')]
    const under = await condenseTranscript(messages, {
      thresholdTokens: 100,
      estimateTokens: () => 50,
    })
    expect(under.condensed).toBe(false)
    const over = await condenseTranscript(messages, {
      thresholdTokens: 100,
      estimateTokens: () => 101,
      keepHead: 1,
      keepTail: 1,
    })
    expect(over.condensed).toBe(true)
    expect(over.estimatedTokensBefore).toBe(101)
  })
})
