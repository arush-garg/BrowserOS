import { afterAll, beforeAll, describe, it, setDefaultTimeout } from 'bun:test'
import assert from 'node:assert'
import { URL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { cleanupBrowserOS, ensureBrowserOS } from './__helpers__/index'
import type { TestEnvironmentConfig } from './__helpers__/setup'

setDefaultTimeout(180000)

let config: TestEnvironmentConfig
let mcpClient: Client | null = null
let mcpTransport: StreamableHTTPClientTransport | null = null

function getBaseUrl(): string {
  return `http://127.0.0.1:${config.serverPort}`
}

describe('semantic_action integration test', () => {
  beforeAll(async () => {
    config = await ensureBrowserOS()

    mcpClient = new Client({
      name: 'browseros-integration-test-client',
      version: '1.0.0',
    })

    const serverUrl = new URL(`${getBaseUrl()}/mcp`)
    mcpTransport = new StreamableHTTPClientTransport(serverUrl, {
      requestInit: {
        signal: AbortSignal.timeout(180000),
      },
    })

    await mcpClient.connect(mcpTransport)
    console.log('MCP client connected\n')
  })

  afterAll(async () => {
    if (mcpTransport) {
      console.log('\nClosing MCP client...')
      await mcpTransport.close()
      mcpTransport = null
      mcpClient = null
      console.log('MCP client closed')
    }

    await cleanupBrowserOS()
  })

  it('semantic_action tool is registered', async () => {
    assert.ok(mcpClient, 'MCP client should be connected')
    const result = await mcpClient.listTools()
    assert.ok(result.tools, 'Should return tools array')
    const semanticAction = result.tools?.find(
      (t) => t.name === 'semantic_action',
    )
    assert.ok(semanticAction, 'semantic_action should be in tool list')
    console.log('semantic_action found:', semanticAction?.description)
  })

  it('semantic_action can make a real Laya advisory decision', async () => {
    const client = mcpClient
    if (!client) throw new Error('MCP client should be connected')

    const tabsResult = await client.callTool({
      name: 'tabs',
      arguments: { action: 'list' },
    })
    const pageMatch = JSON.stringify(tabsResult).match(/\[(\d+)\]/)
    assert.ok(pageMatch?.[1], 'tabs should return a page id')

    const semanticResult = await client.callTool(
      {
        name: 'semantic_action',
        arguments: {
          page: Number(pageMatch[1]),
          goal: 'Click the first button on the page',
          execute: false,
        },
      },
      undefined,
      { timeout: 180000 },
    )
    assert.equal(semanticResult.isError, undefined)
    const text = semanticResult.content.find((item) => item.type === 'text')
    assert.ok(text && 'text' in text, 'semantic_action should return text')
    assert.match(
      text.text,
      /^(CLICK|TYPE_TEXT|SELECT|SCROLL_UP|SCROLL_DOWN|WAIT|DONE|BLOCKED)/,
    )
  })
})
