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
    console.log('tabsResult:', JSON.stringify(tabsResult, null, 2))
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
    console.log('semanticResult:', JSON.stringify(semanticResult, null, 2))
    assert.equal(semanticResult.isError, undefined)
    const text = semanticResult.content.find((item) => item.type === 'text')
    assert.ok(text && 'text' in text, 'semantic_action should return text')
    assert.match(
      text.text,
      /^(CLICK|TYPE_TEXT|SELECT|SCROLL_UP|SCROLL_DOWN|WAIT|DONE|BLOCKED)/,
    )
  })

  // Accessible names carry no colour, so only the screenshot can separate the
  // two layouts; the chosen target must follow the red button across them.
  it('semantic_action uses the screenshot to pick the visually described target', async () => {
    const client = mcpClient
    if (!client) throw new Error('MCP client should be connected')

    const tabsResult = await client.callTool({
      name: 'tabs',
      arguments: { action: 'list' },
    })
    const pageMatch = JSON.stringify(tabsResult).match(/\[(\d+)\]/)
    assert.ok(pageMatch?.[1], 'tabs should return a page id')
    const page = Number(pageMatch?.[1])

    const layout = (left: string, right: string) =>
      `data:text/html,${encodeURIComponent(
        `<body style="margin:0;display:flex;gap:120px;justify-content:center;align-items:center;height:100vh">
          <button style="width:280px;height:120px;border:0;font-size:48px;color:white;background:${left}">A</button>
          <button style="width:280px;height:120px;border:0;font-size:48px;color:white;background:${right}">B</button>
        </body>`,
      )}`

    const chooseRed = async (url: string) => {
      await client.callTool({
        name: 'navigate',
        arguments: { page, action: 'url', url, snapshot: false },
      })
      const result = await client.callTool(
        {
          name: 'semantic_action',
          arguments: { page, goal: 'Click the red button', execute: false },
        },
        undefined,
        { timeout: 180000 },
      )
      console.log('semanticResult:', JSON.stringify(result, null, 2))
      assert.equal(result.isError, undefined)
      const text = (result.content as { type: string; text?: string }[]).find(
        (item) => item.type === 'text',
      )?.text
      if (!text) throw new Error('semantic_action should return text')
      // structuredContent is stripped for schemaless tools; the summary is
      // the only signal of a text-only fallback.
      assert.doesNotMatch(text, /Screenshot not used/)
      return text.match(/\(button "([AB])"\)/)?.[1]
    }

    assert.equal(await chooseRed(layout('#d11', '#1a4')), 'A')
    assert.equal(await chooseRed(layout('#1a4', '#d11')), 'B')
  })
})
