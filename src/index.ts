import NoteEditor from './NoteEditor.vue'
import type { SidebarNote, SaveStatus } from './types'

export { NoteEditor }
export default NoteEditor
export * from './types'
export type { SidebarNote, SaveStatus }

// 调试开关 API（详见 ./debug）
export {
  DEBUG_NAMESPACES,
  createDebugLogger,
  describeDebug,
  disableDebug,
  enableDebug,
  enabledDebugNamespaces,
  initDebug,
  isDebugOn,
  listDebug,
  matchesNamespace,
  setDebug,
  silenceDebug,
} from './debug'
export type { DebugNamespace } from './debug'
