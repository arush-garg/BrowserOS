import { writeTempToolOutputFile } from './output-file'
import { selectRelevantByTokens } from './snapshot-relevance'
import { estimateTextTokens } from './token-estimate'
import { wrapUntrusted } from './trust-boundary'

const LARGE_SNAPSHOT_TOKEN_THRESHOLD = 15_000
const MAX_INLINE_EXCERPT_TOKENS = 2_500 // Reduced to focus on more relevant context

export interface FormattedSnapshot {
  text: string
  structured?: Record<string, unknown>
}

/** Formats page snapshots for direct tools and automatic post-action readback. */
export async function formatSnapshotResult(
  snapshot: string,
  origin: string,
): Promise<FormattedSnapshot> {
  const snapshotText = snapshot || '(empty page)'
  const wrappedSnapshot = wrapUntrusted(snapshotText, origin)
  const contentLength = wrappedSnapshot.length
  const tokenEstimate = estimateTextTokens(wrappedSnapshot)

  if (tokenEstimate > LARGE_SNAPSHOT_TOKEN_THRESHOLD) {
    // Rank rather than slice: the refs an agent needs are as likely to sit at the bottom
    // of a long page as at the top.
    const excerpt = selectRelevantByTokens(snapshotText, {
      budgetTokens: MAX_INLINE_EXCERPT_TOKENS,
    }).text
    try {
      const path = await writeTempToolOutputFile({
        toolName: 'snapshot',
        extension: 'md',
        content: wrappedSnapshot,
      })

      return {
        text: [
          `Large snapshot (${tokenEstimate} estimated tokens, ${contentLength} chars) saved to: ${path}`,
          'Read the file for the full snapshot and refs.',
          `Showing the ~${MAX_INLINE_EXCERPT_TOKENS} most relevant estimated tokens inline (elided nodes are marked):`,
          wrapUntrusted(excerpt, origin),
        ].join('\n'),
        structured: {
          path,
          contentLength,
          tokenEstimate,
          writtenToFile: true,
        },
      }
    } catch (error) {
      const saveError = error instanceof Error ? error.message : String(error)
      return {
        text: [
          `Large snapshot (${tokenEstimate} estimated tokens, ${contentLength} chars) could not be saved to a BrowserOS output file: ${saveError}`,
          `Showing the ~${MAX_INLINE_EXCERPT_TOKENS} most relevant estimated tokens instead (elided nodes are marked):`,
          wrapUntrusted(excerpt, origin),
        ].join('\n'),
        structured: {
          contentLength,
          tokenEstimate,
          writtenToFile: false,
          outputWriteFailed: true,
          error: saveError,
        },
      }
    }
  }

  return {
    text: wrappedSnapshot,
    structured: { contentLength, tokenEstimate, writtenToFile: false },
  }
}
