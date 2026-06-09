import { HERMES_SUPPORTED_BROWSEROS_PROVIDER_TYPES } from '@browseros/shared/constants/hermes'
import Fuse from 'fuse.js'
import { Check, ChevronDown } from 'lucide-react'
import { type FC, useMemo, useRef, useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { getModelsForProvider, type ModelInfo } from '../ai-settings/models'

/** Sentinel meaning "let hermes use the model configured in ~/.hermes". */
export const HERMES_DEFAULT_MODEL = 'default'

interface HermesModelPickerProps {
  /** Selected model id, or HERMES_DEFAULT_MODEL for the ~/.hermes default. */
  value: string
  onChange: (modelId: string) => void
}

/** Union of models across Hermes-supported providers, deduped by id. */
function useHermesModelOptions(): ModelInfo[] {
  return useMemo(() => {
    const seen = new Set<string>()
    const models: ModelInfo[] = []
    for (const providerType of HERMES_SUPPORTED_BROWSEROS_PROVIDER_TYPES) {
      for (const model of getModelsForProvider(providerType)) {
        if (seen.has(model.modelId)) continue
        seen.add(model.modelId)
        models.push(model)
      }
    }
    return models
  }, [])
}

/**
 * Model picker for host-mode Hermes. Hermes reads providers/auth from the
 * user's ~/.hermes, so this only selects which model to launch with
 * (`hermes -m <model>`). Suggestions come from the known model catalog,
 * but any id can be typed (e.g. Nous models that aren't in the catalog).
 * Selecting "Default" launches with the ~/.hermes default model.
 */
export const HermesModelPicker: FC<HermesModelPickerProps> = ({
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const models = useHermesModelOptions()

  const fuse = useMemo(
    () =>
      new Fuse(models, { keys: ['modelId'], threshold: 0.4, distance: 100 }),
    [models],
  )
  const filtered = search ? fuse.search(search).map((r) => r.item) : models
  const showCustomEntry =
    !!search &&
    search !== HERMES_DEFAULT_MODEL &&
    !filtered.some((m) => m.modelId === search)

  const isDefault = !value || value === HERMES_DEFAULT_MODEL
  const label = isDefault ? 'Default (use ~/.hermes config)' : value

  const select = (modelId: string) => {
    onChange(modelId)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs',
            isDefault ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search models or type a model id..."
            value={search}
            onValueChange={(v) => {
              setSearch(v)
              requestAnimationFrame(() => listRef.current?.scrollTo(0, 0))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search) {
                e.preventDefault()
                e.stopPropagation()
                select(search)
              }
            }}
          />
          <CommandList ref={listRef}>
            <CommandEmpty>
              No models found. Press Enter to use &quot;{search}&quot;
            </CommandEmpty>
            {!search && (
              <CommandGroup>
                <CommandItem
                  value={HERMES_DEFAULT_MODEL}
                  onSelect={() => select(HERMES_DEFAULT_MODEL)}
                >
                  <span className="flex-1 truncate">
                    Default (use ~/.hermes config)
                  </span>
                  {isDefault && <Check className="ml-2 h-4 w-4 shrink-0" />}
                </CommandItem>
              </CommandGroup>
            )}
            {showCustomEntry && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`custom:${search}`}
                  onSelect={() => select(search)}
                >
                  <span className="flex-1 truncate">{search}</span>
                  {value === search && (
                    <Check className="ml-2 h-4 w-4 shrink-0" />
                  )}
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((model) => (
                  <CommandItem
                    key={model.modelId}
                    value={model.modelId}
                    onSelect={() => select(model.modelId)}
                  >
                    <span className="flex-1 truncate">{model.modelId}</span>
                    {value === model.modelId && (
                      <Check className="ml-2 h-4 w-4 shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
