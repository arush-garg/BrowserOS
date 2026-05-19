import {
  BotIcon,
  CheckCircle2,
  ChevronDownIcon,
  CircleDashed,
  Clock,
  Loader2,
  ShieldCheck,
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
import { ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type {
  ToolInvocationInfo,
  ToolInvocationState,
} from './getMessageSegments'

interface ToolBatchProps {
  tools: ToolInvocationInfo[]
  isLastBatch: boolean
  isLastMessage: boolean
  isStreaming: boolean
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string) => void
}

export const ToolBatch: FC<ToolBatchProps> = ({
  tools,
  isLastBatch,
  isLastMessage,
  isStreaming,
  onApprove,
  onDeny,
}) => {
  const hasPendingApproval = tools.some((t) => t.state === 'approval-requested')
  const shouldBeOpen =
    (isLastMessage && isLastBatch && isStreaming) || hasPendingApproval
  const [isOpen, setIsOpen] = useState(shouldBeOpen)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)

  useEffect(() => {
    if (hasPendingApproval) {
      setIsOpen(true)
      return
    }
    if (isLastMessage && !hasUserInteracted) {
      if (isLastBatch) {
        setIsOpen(isStreaming)
      } else {
        setIsOpen(false)
      }
    }
  }, [
    isStreaming,
    isLastMessage,
    isLastBatch,
    hasUserInteracted,
    hasPendingApproval,
  ])

  const completedCount = tools.filter((t) => isToolCompleted(t.state)).length
  const triggerTitle = hasPendingApproval
    ? 'Waiting for approval...'
    : `${completedCount}/${tools.length} actions completed`

  const onManualToggle = (newState: boolean) => {
    setHasUserInteracted(true)
    setIsOpen(newState)
  }

  return (
    <Task open={isOpen} onOpenChange={onManualToggle}>
      <TaskTrigger title={triggerTitle} TriggerIcon={BotIcon} />
      <TaskContent>
        {tools.map((tool) => (
          <ToolBatchItem
            key={tool.toolCallId}
            tool={tool}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </TaskContent>
    </Task>
  )
}

const ToolBatchItem: FC<{
  tool: ToolInvocationInfo
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string) => void
}> = ({ tool, onApprove, onDeny }) => {
  const [open, setOpen] = useState(tool.state === 'approval-requested')
  const outputText = formatToolOutput(tool.output)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/60 bg-card/40">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
          >
            <ToolStatusIcon state={tool.state} />
            <div className="min-w-0 flex-1">
              <TaskItem className="font-medium text-foreground">
                {formatToolName(tool.toolName)}
              </TaskItem>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {getToolPreview(tool, outputText)}
              </p>
            </div>
            <ChevronDownIcon
              className={cn(
                'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-border/60 border-t">
          <div className="space-y-4 p-3">
            <ToolInput input={tool.input} className="p-0" />
            {tool.state === 'approval-requested' &&
              tool.approval?.id != null && (
                <ApprovalButtons
                  approvalId={tool.approval.id}
                  onApprove={onApprove}
                  onDeny={onDeny}
                />
              )}
            {tool.state !== 'approval-requested' && (
              <ToolOutput
                output={outputText ?? tool.output}
                errorText={
                  tool.state === 'output-error'
                    ? 'Tool execution failed.'
                    : undefined
                }
                className="p-0"
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

const formatToolName = (name: string) => {
  return name
    ?.replace(/_/g, ' ')
    ?.replace(/([a-z])([A-Z])/g, '$1 $2')
    ?.replace(/^./, (s) => s.toUpperCase())
}

const isToolCompleted = (state: ToolInvocationState) =>
  state === 'result' || state === 'output-available'

const isToolInProgress = (state: ToolInvocationState) =>
  state === 'call' || state === 'input-available'

const isToolError = (state: ToolInvocationState) => state === 'output-error'

const isToolDenied = (state: ToolInvocationState) => state === 'output-denied'

const isToolApprovalPending = (state: ToolInvocationState) =>
  state === 'approval-requested'

const formatToolOutput = (output: unknown[]): string | null => {
  const textParts = collectTextParts(output)
    .map((part) => part.trim())
    .filter(Boolean)

  if (textParts.length === 0) {
    return null
  }

  return textParts.join('\n\n')
}

const collectTextParts = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextParts(item))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if (typeof record.text === 'string') {
      return [record.text]
    }

    if (typeof record.value === 'string' && typeof record.type === 'string') {
      return [record.value]
    }

    if (Array.isArray(record.content)) {
      return collectTextParts(record.content)
    }
  }

  return []
}

const getToolPreview = (
  tool: ToolInvocationInfo,
  outputText: string | null,
) => {
  if (tool.state === 'approval-requested') {
    return 'Waiting for approval'
  }

  if (tool.state === 'output-error') {
    return outputText ?? 'Execution failed'
  }

  if (outputText) {
    return outputText
  }

  if (tool.state === 'call' || tool.state === 'input-available') {
    return 'Running...'
  }

  return 'Click to view details'
}

const ApprovalButtons: FC<{
  approvalId: string
  onApprove?: (id: string) => void
  onDeny?: (id: string) => void
}> = ({ approvalId, onApprove, onDeny }) => (
  <div className="mt-1 mb-2 ml-6 flex items-center gap-2">
    <Button
      size="sm"
      className="h-7 gap-1 px-2.5 text-xs"
      onClick={() => onApprove?.(approvalId)}
    >
      <ShieldCheck className="size-3" />
      Approve
    </Button>
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1 px-2.5 text-xs"
      onClick={() => onDeny?.(approvalId)}
    >
      <ShieldX className="size-3" />
      Deny
    </Button>
  </div>
)

const ToolStatusIcon: FC<{ state: ToolInvocationState }> = ({ state }) => {
  if (isToolCompleted(state)) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  }
  if (isToolApprovalPending(state)) {
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
