import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GOAL_CANCELLED_EVENT } from '@/lib/constants/analyticsEvents'
import { type GoalState, goalStorage } from '@/lib/goal/goal-storage'
import { track } from '@/lib/metrics/track'

export function GoalBanner() {
  const [goal, setGoal] = useState<GoalState | null>(null)

  useEffect(() => {
    goalStorage.getValue().then(setGoal)
    const unwatch = goalStorage.watch(setGoal)
    return () => unwatch()
  }, [])

  if (!goal?.active) return null

  return (
    <div className="flex items-center gap-2 border-border/40 border-b bg-accent/20 px-4 py-1.5 text-xs">
      <span className="shrink-0 font-medium text-primary">/goal</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {goal.goal}
      </span>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => {
          track(GOAL_CANCELLED_EVENT)
          goalStorage.setValue({ ...goal, active: false })
        }}
        title="Cancel goal"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
