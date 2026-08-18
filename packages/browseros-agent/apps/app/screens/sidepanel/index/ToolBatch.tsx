import {
  BotIcon,
  CheckCircle2,
  CircleDashed,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  ShieldX,
  XCircle,
} from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from '@/components/ai-elements/task'
import type {
  ToolInvocationInfo,
  ToolInvocationState,
} from './getMessageSegments'

const URL_PATTERN = /https?:\/\/[^\s<>"')\],;]+/g
const FILE_PATH_PATTERN = /(?:^|\s)(\/[\w./-]+)/g

export interface ToolBatchProps {
  tools: ToolInvocationInfo[]
  isLastBatch: boolean
  isLastMessage: boolean
  isStreaming: boolean
}

export const ToolBatch: FC<ToolBatchProps> = ({
  tools,
  isLastBatch,
  isLastMessage,
  isStreaming,
}) => {
  const shouldBeOpen = isLastMessage && isLastBatch && isStreaming
  const [isOpen, setIsOpen] = useState(shouldBeOpen)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)

  useEffect(() => {
    if (isLastMessage && !hasUserInteracted) {
      if (isLastBatch) {
        setIsOpen(isStreaming)
      } else {
        setIsOpen(false)
      }
    }
  }, [isStreaming, isLastMessage, isLastBatch, hasUserInteracted])

  const completedCount = tools.filter((t) => isToolCompleted(t.state)).length
  const inProgressCount = tools.filter((t) => isToolInProgress(t.state)).length
  const triggerTitle = `${completedCount}/${tools.length} actions completed${
    inProgressCount > 0 ? ` · ${inProgressCount} in progress` : ''
  }`

  const onManualToggle = (newState: boolean) => {
    setHasUserInteracted(true)
    setIsOpen(newState)
  }

  return (
    <Task open={isOpen} onOpenChange={onManualToggle}>
      <TaskTrigger title={triggerTitle} TriggerIcon={BotIcon} />
      <TaskContent>
        {tools.map((tool) => (
          <div key={tool.toolCallId}>
            <TaskItem className="flex items-center gap-2">
              <ToolStatusIcon state={tool.state} />
              <span className="flex-1">{formatToolName(tool.toolName)}</span>
              {tool.state === 'input-available' &&
                typeof tool.input?.description === 'string' &&
                tool.input.description.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    <Loader2 className="h-3 w-3 animate-spin text-[var(--accent-orange)]" />
                    {truncateDescription(tool.input.description)}
                  </span>
                )}
            </TaskItem>
            {tool.state === 'output-available' &&
              tool.output &&
              formatToolLinks(tool.output).length > 0 && (
                <div className="ml-7 flex flex-col gap-0.5">
                  {formatToolLinks(tool.output).map((link) => (
                    <ToolLink key={link.value} link={link} />
                  ))}
                </div>
              )}
          </div>
        ))}
      </TaskContent>
    </Task>
  )
}

const formatToolName = (name: string) => {
  return name
    ?.replace(/_/g, ' ')
    ?.replace(/([a-z])([A-Z])/g, '$1 $2')
    ?.replace(/^./, (s) => s.toUpperCase())
}

const truncateDescription = (description: string): string => {
  if (description.length <= 40) return description
  return `${description.slice(0, 37)}...`
}

const isToolCompleted = (state: ToolInvocationState) =>
  state === 'result' || state === 'output-available'

const isToolInProgress = (state: ToolInvocationState) =>
  state === 'call' || state === 'input-available'

const isToolError = (state: ToolInvocationState) => state === 'output-error'

const isToolDenied = (state: ToolInvocationState) => state === 'output-denied'

const isToolWaitingForApproval = (state: ToolInvocationState) =>
  state === 'approval-requested'

type ToolLink = { value: string; type: 'url' | 'path' }

function extractTextFromOutput(output: unknown): string[] {
  if (!output) return []
  if (typeof output === 'string') return [output]
  if (Array.isArray(output)) {
    return output.flatMap(extractTextFromOutput)
  }
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>
    if (typeof obj.content === 'string') return [obj.content]
    return extractTextFromOutput(obj.content)
  }
  return []
}

function formatToolLinks(output: unknown): ToolLink[] {
  const texts = extractTextFromOutput(output)
  const seen = new Set<string>()
  const links: ToolLink[] = []

  for (const text of texts) {
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;)]+$/, '')
      if (!seen.has(url)) {
        seen.add(url)
        links.push({ value: url, type: 'url' })
      }
    }
    for (const match of text.matchAll(FILE_PATH_PATTERN)) {
      const path = match[1].trim()
      if (!seen.has(path) && path.includes('/')) {
        seen.add(path)
        links.push({ value: path, type: 'path' })
      }
    }
  }

  return links
}

const ToolLink: FC<{ link: ToolLink }> = ({ link }) => {
  if (link.type === 'url') {
    return (
      <button
        type="button"
        onClick={() => chrome.tabs.create({ url: link.value })}
        className="flex items-center gap-1 text-blue-500 text-xs hover:text-blue-600 hover:underline"
      >
        <ExternalLink className="h-3 w-3 shrink-0" />
        <span className="max-w-[280px] truncate">{link.value}</span>
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      <FileText className="h-3 w-3 shrink-0" />
      <span className="max-w-[280px] truncate">{link.value}</span>
    </span>
  )
}

const ToolStatusIcon: FC<{ state: ToolInvocationState }> = ({ state }) => {
  if (isToolCompleted(state)) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  }
  if (isToolWaitingForApproval(state)) {
    return <Clock className="h-3.5 w-3.5 text-yellow-500" />
  }
  if (isToolDenied(state)) {
    return <ShieldX className="h-3.5 w-3.5 text-red-400" />
  }
  if (isToolInProgress(state)) {
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-orange)]" />
    )
  }
  if (isToolError(state)) {
    return <XCircle className="h-3.5 w-3.5 text-destructive" />
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
}
