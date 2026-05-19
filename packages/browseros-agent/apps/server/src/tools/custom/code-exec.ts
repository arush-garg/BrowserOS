import { tool } from 'ai'
import { z } from 'zod'
import {
  executeWithMetrics,
  toModelOutput,
  truncateTail,
} from '../filesystem/utils'

const TOOL_NAME = 'code_execute'
const CODE_EXECUTION_TIMEOUT = 5

export function createCodeExecutionTool() {
  return tool({
    description:
      'Execute short JavaScript or Python code snippets safely for calculation, data transformation, or text generation.',
    inputSchema: z.object({
      language: z
        .enum(['javascript', 'python'])
        .describe('Programming language to execute'),
      code: z.string().describe('Code snippet to execute'),
      timeoutSec: z
        .number()
        .int()
        .optional()
        .default(CODE_EXECUTION_TIMEOUT)
        .describe('Execution timeout in seconds'),
      sandboxMode: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to run in sandbox mode'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const timeoutMs = params.timeoutSec * 1000
        const command = params.language === 'javascript' ? 'node' : 'python3'

        const proc = Bun.spawn([command, '-c', params.code], {
          stdout: 'pipe',
          stderr: 'pipe',
        })

        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          proc.kill()
        }, timeoutMs)

        const [stdoutText, stderrText] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])

        const exitCode = await proc.exited
        clearTimeout(timer)

        if (timedOut) {
          let output = stdoutText
          if (stderrText) output += (output ? '\n' : '') + stderrText
          const truncated = truncateTail(output)
          return {
            text: `${params.language} execution timed out after ${params.timeoutSec}s\n\n${truncated.content}`,
            isError: true,
          }
        }

        let output = stdoutText
        if (stderrText) output += (output ? '\n' : '') + stderrText

        const truncated = truncateTail(output)
        let result = truncated.content
        if (truncated.truncated) {
          result = `(Output truncated. Showing last ${truncated.keptLines} of ${truncated.totalLines} lines)\n${result}`
        }

        if (exitCode !== 0) {
          result += `\n\n[Exit code: ${exitCode}]`
          return { text: result, isError: true }
        }

        return { text: result || '(no output)' }
      }),
    toModelOutput,
  })
}
