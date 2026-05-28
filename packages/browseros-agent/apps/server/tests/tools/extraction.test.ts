import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { pruneElements, scoreElement } from '../../src/browser/extraction'

describe('extraction helpers', () => {
  it('pruneElements keeps highest scored items', () => {
    const items = []
    for (let i = 0; i < 10; i++) {
      items.push({
        backendNodeId: i,
        text: i % 2 === 0 ? 'Long text '.repeat(i + 1) : 'x',
        role: i % 3 === 0 ? 'button' : undefined,
      })
    }

    const pruned = pruneElements(items as any, 4)
    assert.strictEqual(pruned.length, 4)

    // Ensure highest score first roughly corresponds to longer text / buttons
    const scores = pruned.map((p) => scoreElement(p as any))
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] <= scores[i - 1])
    }
  })
})
