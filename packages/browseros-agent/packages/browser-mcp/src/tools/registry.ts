import { act } from './act'
import { action_guard } from './action-guard'
import { assert } from './assert'
import { diff } from './diff'
import { download } from './download'
import { evaluate } from './evaluate'
import {
  extract,
  fill_form_by_ref,
  find_elements,
  search_page,
} from './extract-tools'
import { fill_form, inspect_form } from './form'
import type { ToolDefinition } from './framework'
import { grep } from './grep'
import { history } from './history'
import { monitor } from './monitor'
import { navigate } from './navigate'
import { observe_page } from './observe-page'
import { pdf } from './pdf'
import { read } from './read'
import { run } from './run'
import { screenshot } from './screenshot'
import { semantic_action } from './semantic-action'
import { snapshot } from './snapshot'
import { tab_groups } from './tab-groups'
import { tabs } from './tabs'
import { upload } from './upload'
import { wait } from './wait'
import { watch_page } from './watch-page'
import { windows } from './windows'

export const BROWSER_TOOLS: readonly ToolDefinition[] = [
  tabs,
  tab_groups,
  history,
  navigate,
  snapshot,
  observe_page,
  watch_page,
  action_guard,
  extract,
  search_page,
  find_elements,
  fill_form_by_ref,
  diff,
  monitor,
  semantic_action,
  act,
  assert,
  download,
  upload,
  inspect_form,
  fill_form,
  read,
  grep,
  screenshot,
  pdf,
  wait,
  windows,
  evaluate,
  run,
]
