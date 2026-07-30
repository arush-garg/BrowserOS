import { storage } from '@wxt-dev/storage'

export interface GoalState {
  goal: string
  active: boolean
  createdAt: number
}

export const goalStorage = storage.defineItem<GoalState | null>('local:goal', {
  defaultValue: null,
})
