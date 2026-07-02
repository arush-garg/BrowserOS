import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

interface OnboardingCopyBlockProps {
  text: string
}

/** Renders the Claude MCP CLI snippet with clipboard copy feedback. */
export function OnboardingCopyBlock({ text }: OnboardingCopyBlockProps) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-[#15140F] px-3.5 py-3">
      <span className="font-mono text-[#6FCF8E] text-[12.5px]">$</span>
      <code className="flex-1 truncate font-mono text-[#EDEAE2] text-[12.5px]">
        {text}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 font-semibold text-[11.5px] text-white transition hover:bg-white/15"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
