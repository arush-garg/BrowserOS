import { tool } from 'ai'
import { z } from 'zod'
import { AppsScriptClient } from '../../lib/clients/klavis/apps-script-client'
import {
  appendSheetRow,
  appendSlide,
  appendToDoc,
  findInSheet,
  getDocStructure,
  getDocText,
  getSheetNames,
  getSheetValues,
  getSlideCount,
  getSlidesContent,
  insertTextInDoc,
  replaceInDoc,
  setSheetValues,
  updateSlideText,
} from '../../lib/google-apps-script-templates'
import { executeWithMetrics, toModelOutput } from '../filesystem/utils'

const TOOL_READ_GOOGLE_DOC = 'read_google_doc'
const TOOL_READ_GOOGLE_SHEET = 'read_google_sheet'
const TOOL_READ_GOOGLE_SLIDES = 'read_google_slides'
const TOOL_EDIT_GOOGLE_DOC = 'edit_google_doc'
const TOOL_EDIT_GOOGLE_SHEET = 'edit_google_sheet'
const TOOL_EDIT_GOOGLE_SLIDES = 'edit_google_slides'

function formatResult(result: unknown): string {
  if (result === null || result === undefined) {
    return '(Script completed with no result)'
  }
  if (typeof result === 'string') {
    return result
  }
  return JSON.stringify(result, null, 2)
}

async function runScript(
  client: AppsScriptClient,
  app: 'docs' | 'sheets' | 'slides',
  script: string,
  scriptParams: unknown[],
): Promise<{ text: string; isError?: boolean }> {
  const response = await client.runAppsScript('current-user', {
    app,
    script,
    scriptParams,
  })

  if (response.error) {
    return {
      text: `Apps Script execution failed: ${response.error.message} (Code: ${response.error.code})`,
      isError: true,
    }
  }

  return { text: formatResult(response.result) }
}

export function createReadGoogleDocTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Read content from a Google Doc. Extracts full text and document structure. Requires the document ID from the URL (e.g. https://docs.google.com/document/d/DOC_ID/edit).',
    inputSchema: z.object({
      documentId: z.string().describe('Google Doc document ID'),
      mode: z
        .enum(['text', 'structure'])
        .default('text')
        .describe(
          'text: full document text; structure: headings and word count',
        ),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_READ_GOOGLE_DOC, async () => {
        const script =
          params.mode === 'structure'
            ? getDocStructure(params.documentId)
            : getDocText(params.documentId)
        return runScript(client, 'docs', script, [params.documentId])
      }),
    toModelOutput,
  })
}

export function createReadGoogleSheetTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Read data from a Google Spreadsheet. Can list sheet names or read cell values from a range.',
    inputSchema: z.object({
      spreadsheetId: z.string(),
      mode: z
        .enum(['sheets', 'values', 'find'])
        .default('values')
        .describe(
          'sheets: list sheet names; values: read cell range; find: search for a value',
        ),
      range: z
        .string()
        .optional()
        .describe(
          "Cell range to read, e.g. 'Sheet1!A1:D20'. Required for values mode.",
        ),
      searchText: z
        .string()
        .optional()
        .describe('Text to search for. Required for find mode.'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_READ_GOOGLE_SHEET, async () => {
        let script: string
        let scriptParams: unknown[]

        if (params.mode === 'sheets') {
          script = getSheetNames(params.spreadsheetId)
          scriptParams = [params.spreadsheetId]
        } else if (params.mode === 'find') {
          if (!params.searchText) {
            return {
              text: 'searchText is required for find mode',
              isError: true,
            }
          }
          script = findInSheet(params.spreadsheetId)
          scriptParams = [params.spreadsheetId, params.searchText]
        } else {
          script = getSheetValues(params.spreadsheetId)
          scriptParams = [params.spreadsheetId, params.range]
        }

        return runScript(client, 'sheets', script, scriptParams)
      }),
    toModelOutput,
  })
}

export function createReadGoogleSlidesTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Read content from a Google Slides presentation. Can get slide count or full slide content.',
    inputSchema: z.object({
      presentationId: z.string(),
      mode: z
        .enum(['content', 'count'])
        .default('content')
        .describe(
          'content: all slides with text and notes; count: slide count and title only',
        ),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_READ_GOOGLE_SLIDES, async () => {
        const script =
          params.mode === 'count'
            ? getSlideCount(params.presentationId)
            : getSlidesContent(params.presentationId)
        return runScript(client, 'slides', script, [params.presentationId])
      }),
    toModelOutput,
  })
}

export function createEditGoogleDocTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Edit a Google Doc. Can append text, replace text, or insert text at start/end.',
    inputSchema: z.object({
      documentId: z.string(),
      operation: z
        .enum(['append', 'replace', 'insert'])
        .describe(
          'append: add paragraph at end; replace: find and replace text; insert: insert at start or end',
        ),
      text: z.string().optional().describe('Text to append or insert'),
      find: z.string().optional().describe('Text to find (for replace)'),
      replace: z.string().optional().describe('Replacement text (for replace)'),
      insertAt: z
        .enum(['start', 'end'])
        .optional()
        .default('end')
        .describe('Where to insert (for insert operation)'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_EDIT_GOOGLE_DOC, async () => {
        if (params.operation === 'append') {
          if (!params.text) {
            return {
              text: 'text is required for append operation',
              isError: true,
            }
          }
          return runScript(client, 'docs', appendToDoc(params.documentId), [
            params.documentId,
            params.text,
          ])
        }

        if (params.operation === 'replace') {
          if (!params.find) {
            return {
              text: 'find is required for replace operation',
              isError: true,
            }
          }
          return runScript(client, 'docs', replaceInDoc(params.documentId), [
            params.documentId,
            { find: params.find, replace: params.replace ?? '' },
          ])
        }

        if (!params.text) {
          return {
            text: 'text is required for insert operation',
            isError: true,
          }
        }
        return runScript(client, 'docs', insertTextInDoc(params.documentId), [
          params.documentId,
          [{ insertAt: params.insertAt, text: params.text }],
        ])
      }),
    toModelOutput,
  })
}

export function createEditGoogleSheetTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Edit a Google Spreadsheet. Can set values in a range or append a new row.',
    inputSchema: z.object({
      spreadsheetId: z.string(),
      operation: z
        .enum(['set_values', 'append_row'])
        .describe(
          'set_values: write to a range; append_row: add a row at the end',
        ),
      sheet: z
        .string()
        .optional()
        .describe('Sheet name, defaults to first sheet'),
      range: z
        .string()
        .optional()
        .describe("A1 notation range for set_values, e.g. 'A1:C3'"),
      values: z
        .array(z.array(z.unknown()))
        .optional()
        .describe(
          '2D array of values for set_values, or 1D array for append_row',
        ),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_EDIT_GOOGLE_SHEET, async () => {
        if (params.operation === 'set_values') {
          return runScript(
            client,
            'sheets',
            setSheetValues(params.spreadsheetId),
            [
              params.spreadsheetId,
              {
                sheet: params.sheet,
                range: params.range,
                values: params.values,
              },
            ],
          )
        }

        return runScript(
          client,
          'sheets',
          appendSheetRow(params.spreadsheetId),
          [
            params.spreadsheetId,
            { sheet: params.sheet, values: params.values?.[0] },
          ],
        )
      }),
    toModelOutput,
  })
}

export function createEditGoogleSlidesTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Edit a Google Slides presentation. Can append a new slide or replace text on a specific slide.',
    inputSchema: z.object({
      presentationId: z.string(),
      operation: z
        .enum(['append_slide', 'replace_text'])
        .describe(
          'append_slide: add a new slide; replace_text: find and replace text on a slide',
        ),
      slideIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Slide index (0-based) for replace_text'),
      title: z.string().optional().describe('Slide title for append_slide'),
      body: z.string().optional().describe('Slide body text for append_slide'),
      find: z.string().optional().describe('Text to find for replace_text'),
      replace: z
        .string()
        .optional()
        .describe('Replacement text for replace_text'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_EDIT_GOOGLE_SLIDES, async () => {
        if (params.operation === 'append_slide') {
          return runScript(
            client,
            'slides',
            appendSlide(params.presentationId),
            [params.presentationId, { title: params.title, body: params.body }],
          )
        }

        return runScript(
          client,
          'slides',
          updateSlideText(params.presentationId),
          [
            params.presentationId,
            {
              slideIndex: params.slideIndex,
              find: params.find,
              replace: params.replace,
            },
          ],
        )
      }),
    toModelOutput,
  })
}
