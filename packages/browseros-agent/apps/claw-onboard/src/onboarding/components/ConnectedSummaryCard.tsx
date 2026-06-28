import { CheckCircle2 } from 'lucide-react'

/** Shows the successful Claude connection state. */
export function ConnectedSummaryCard() {
  return (
    <div className="mb-[18px] flex animate-fade-up items-center gap-3 rounded-xl border border-green/30 bg-green-tint p-[18px]">
      <span className="flex size-[30px] items-center justify-center rounded-lg bg-card text-green">
        <CheckCircle2 className="size-[18px]" />
      </span>
      <div>
        <div className="font-bold text-[14px]">Connected to Claude</div>
        <div className="text-[12.5px] text-ink-2">
          68 browser tools available . scope: user
        </div>
      </div>
    </div>
  )
}
