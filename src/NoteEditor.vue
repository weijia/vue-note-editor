<template>
  <div class="note-editor">
    <div v-if="note" class="ne-tagbar">
      <span v-for="(tag, i) in (note.tags || [])" :key="i" class="ne-chip">
        {{ tag }}
        <button class="ne-chip-x" type="button" :aria-label="`移除标签 ${tag}`" @click="removeTag(i)">×</button>
      </span>
      <input
        v-model="tagInput"
        class="ne-tag-input"
        type="text"
        placeholder="+ 添加标签"
        @keydown.enter.prevent="addTag"
      />
      <button class="ne-tag-add" type="button" @click="addTag">+ 添加标签</button>
    </div>

    <div class="ne-editor">
      <div v-show="note" ref="editorEl" class="ne-vditor"></div>
      <div v-if="!note" class="ne-empty">暂无选中笔记，点击左侧列表选择或新建笔记</div>
    </div>

    <div class="ne-statusbar">
      <span class="ne-count">字数 {{ wordCount }}</span>
      <span class="ne-right">
        <span v-if="currentStatus === 'saving'" class="ne-status ne-saving">保存中…</span>
        <span v-else-if="currentStatus === 'saved'" class="ne-status ne-saved">已保存</span>
        <span v-else-if="currentStatus === 'error'" class="ne-status ne-error" role="button" @click="onRetry">保存失败，点击重试</span>
        <span v-else-if="lastSavedTime" class="ne-time">{{ lastSavedTime }}</span>
        <button class="ne-save-btn" type="button" title="手动保存" @click="onManualSave">💾</button>
      </span>
    </div>

    <!-- 自建表格浮动菜单：点 IR 表格单元格时弹出（官方 IR 模式无此菜单） -->
    <div
      v-if="tableMenu"
      ref="tableMenuEl"
      class="ne-table-menu"
      :style="{ left: tableMenu.x + 'px', top: tableMenu.y + 'px' }"
    >
      <button v-if="tableMenu.pos.rowIndex >= 0" type="button" @click="applyTableOp('row-above')">↑ 在上方插入行</button>
      <button type="button" @click="applyTableOp('row-below')">↓ 在下方插入行</button>
      <button type="button" @click="applyTableOp('col-left')">← 在左侧插入列</button>
      <button type="button" @click="applyTableOp('col-right')">→ 在右侧插入列</button>
      <button v-if="tableMenu.pos.rowIndex >= 0" type="button" @click="applyTableOp('del-row')">删除此行</button>
      <button type="button" @click="applyTableOp('del-col')">删除此列</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { SidebarNote, SaveStatus } from './types'
import { logEditor } from './debug'
import { editTable, type TablePosition, type TableOp } from './tableOps'

const props = withDefaults(
  defineProps<{
    note: SidebarNote | null
    autoSaveDelay?: number
    readonly?: boolean
    saveStatus?: SaveStatus
  }>(),
  {
    autoSaveDelay: 1000,
    readonly: false,
    saveStatus: 'idle',
  },
)

const emit = defineEmits<{
  (e: 'save', content: string): void
  (e: 'update-tags', tags: string[]): void
  (e: 'save-state-change', status: SaveStatus): void
  (e: 'manual-save'): void
}>()

// ★ Vditor 版本锁定 + 多 CDN 兜底
// 之前用 vditor@3（浮动主版本号），每次加载都解析到当时最新的 3.x，行为不稳定；
// 而 IR 模式表格工具条（上/下插行、左/右插列、删行、删列、对齐）依赖 Vditor 正确加载，
// 浮动版本 + 单一 unpkg 源在不可达时会静默失效 → 表现为“点表格没菜单”。
// 这里锁定 3.11.3，并优先 jsDelivr（国内可达），失败回退 unpkg。
const VDITOR_VERSION = '3.11.3'
const VDITOR_CSS_LIST = [
  `https://cdn.jsdelivr.net/npm/vditor@${VDITOR_VERSION}/dist/index.css`,
  `https://unpkg.com/vditor@${VDITOR_VERSION}/dist/index.css`,
]
const VDITOR_JS_LIST = [
  `https://cdn.jsdelivr.net/npm/vditor@${VDITOR_VERSION}/dist/index.min.js`,
  `https://unpkg.com/vditor@${VDITOR_VERSION}/dist/index.min.js`,
]
// Vditor 的 cdn 是资源基址，内部会自行拼接 /dist/... ，故此处不能带 /dist（否则变成 /dist/dist/... 404）。
// 同时优先 jsDelivr（国内可达），失败回退 unpkg。
const VDITOR_CDN = `https://cdn.jsdelivr.net/npm/vditor@${VDITOR_VERSION}`

const editorEl = ref<HTMLElement | null>(null)
const tagInput = ref('')
const currentStatus = ref<SaveStatus>(props.saveStatus)
const lastSavedTime = ref('')
const wordCount = ref(0)

// 自建表格浮动菜单：点 IR 渲染区的表格单元格时弹出（IR 模式官方无此能力）
const tableMenu = ref<{ x: number; y: number; pos: TablePosition } | null>(null)
const tableMenuEl = ref<HTMLElement | null>(null)

let vditor: any = null
let vditorPromise: Promise<any> | null = null
let debounceTimer: number | null = null
let savedRevertTimer: number | null = null
let currentNoteId: string | null = props.note ? props.note._id : null

// 依次尝试加载样式表：前一个 onerror 再挂下一个，保证至少一个生效。
function loadStyleSheets(urls: string[]): void {
  let idx = 0
  const tryNext = () => {
    if (idx >= urls.length) return
    const href = urls[idx++]
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onerror = tryNext
    document.head.appendChild(link)
  }
  tryNext()
}

// 依次尝试多 CDN 加载 Vditor 脚本；任一成功即 resolve，全部失败才 reject。
function loadScriptWithFallback(urls: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    let idx = 0
    const tryNext = () => {
      if (idx >= urls.length) {
        const err = new Error('Failed to load Vditor from all CDNs')
        logEditor.error('loadVditor FAIL all CDNs', urls, err)
        reject(err)
        return
      }
      const src = urls[idx++]
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = () => {
        logEditor.log('loadVditor OK', src)
        resolve((window as any).Vditor)
      }
      script.onerror = () => {
        logEditor.warn('loadVditor CDN 失败，尝试下一个', src)
        tryNext()
      }
      document.head.appendChild(script)
    }
    tryNext()
  })
}

function loadVditor(): Promise<any> {
  const w = window as any
  if (w.Vditor) {
    logEditor.log('loadVditor 复用全局实例')
    return Promise.resolve(w.Vditor)
  }
  if (vditorPromise) {
    logEditor.log('loadVditor 复用进行中的请求')
    return vditorPromise
  }
  logEditor.log('loadVditor START', VDITOR_JS_LIST)
  loadStyleSheets(VDITOR_CSS_LIST)
  vditorPromise = loadScriptWithFallback(VDITOR_JS_LIST)
  return vditorPromise
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function updateWordCount() {
  if (!vditor) return
  const html = typeof vditor.getHTML === 'function' ? vditor.getHTML() : ''
  const text = html.replace(/<[^>]*>/g, '')
  wordCount.value = text.length
}

function doSave() {
  if (!vditor) {
    logEditor.warn('doSave SKIP 编辑器实例不存在')
    return
  }
  const content = typeof vditor.getValue === 'function' ? vditor.getValue() : ''
  logEditor.log('emit save', { id: currentNoteId, length: content.length })
  emit('save', content)
  emit('save-state-change', 'saving')
  currentStatus.value = 'saving'
}

function scheduleSave() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null
    doSave()
  }, props.autoSaveDelay)
}

function flushSave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
    doSave()
  }
}

function onManualSave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (vditor) {
    const content = typeof vditor.getValue === 'function' ? vditor.getValue() : ''
    emit('save', content)
  }
  logEditor.log('emit manual-save', currentNoteId)
  emit('manual-save')
  emit('save-state-change', 'saving')
  currentStatus.value = 'saving'
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    onManualSave()
  }
}

function setStatus(s: SaveStatus) {
  logEditor.log('saveStatus 变化', s)
  currentStatus.value = s
  if (savedRevertTimer) {
    clearTimeout(savedRevertTimer)
    savedRevertTimer = null
  }
  if (s === 'saved') {
    lastSavedTime.value = formatTime(new Date())
    savedRevertTimer = window.setTimeout(() => {
      if (currentStatus.value === 'saved') currentStatus.value = 'idle'
    }, 3000)
  }
}

function removeTag(i: number) {
  if (!props.note) {
    logEditor.warn('removeTag SKIP 无当前笔记')
    return
  }
  const tags = [...(props.note.tags || [])]
  tags.splice(i, 1)
  logEditor.log('emit update-tags（移除）', { removed: i, tags })
  emit('update-tags', tags)
}

function addTag() {
  if (!props.note) {
    logEditor.warn('addTag SKIP 无当前笔记')
    return
  }
  const v = tagInput.value.trim()
  if (!v) return
  const tags = [...(props.note.tags || [])]
  if (!tags.includes(v)) tags.push(v)
  tagInput.value = ''
  logEditor.log('emit update-tags（新增）', { added: v, tags })
  emit('update-tags', tags)
}

// ---- 自建表格浮动菜单（IR 模式官方无行列操作菜单，这里补上）----
function hideTableMenu() {
  if (tableMenu.value) {
    tableMenu.value = null
    document.removeEventListener('click', onDocClick)
  }
}

function onDocClick(e: MouseEvent) {
  if (tableMenuEl.value && !tableMenuEl.value.contains(e.target as Node)) hideTableMenu()
}

function onEditorClick(e: MouseEvent) {
  if (props.readonly || !vditor || !editorEl.value) {
    hideTableMenu()
    return
  }
  const target = e.target as HTMLElement
  const cell = target.closest('td, th') as HTMLElement | null
  if (!cell) {
    hideTableMenu()
    return
  }
  const tableEl = cell.closest('table') as HTMLTableElement | null
  if (!tableEl) {
    hideTableMenu()
    return
  }
  // 仅 IR 模式渲染区内的表格
  if (!editorEl.value.querySelector('.vditor-ir')) {
    hideTableMenu()
    return
  }
  const tables = Array.from(editorEl.value.querySelectorAll('table'))
  const tableIndex = tables.indexOf(tableEl)
  if (tableIndex < 0) {
    hideTableMenu()
    return
  }
  const row = cell.closest('tr') as HTMLTableRowElement | null
  if (!row) {
    hideTableMenu()
    return
  }
  const isHeader = !!cell.closest('thead')
  const colIndex = Array.from(row.children).indexOf(cell)
  let rowIndex = -1
  if (!isHeader) {
    const tbody = row.closest('tbody')
    if (tbody) rowIndex = Array.from(tbody.children).indexOf(row)
  }
  tableMenu.value = { x: e.clientX, y: e.clientY, pos: { tableIndex, rowIndex, colIndex } }
  // 延迟一拍再挂全局监听，避免本次 click 冒泡到 document 把刚弹出的菜单关掉
  document.removeEventListener('click', onDocClick)
  setTimeout(() => document.addEventListener('click', onDocClick), 0)
}

async function applyTableOp(op: TableOp) {
  if (!tableMenu.value || !vditor) return
  const pos = tableMenu.value.pos
  const raw = typeof vditor.getValue === 'function' ? vditor.getValue() : ''
  const newMd = editTable(raw, pos, op)
  if (newMd == null) {
    hideTableMenu()
    return
  }
  vditor.setValue(newMd)
  hideTableMenu()
  scheduleSave()
  // best-effort：把光标放回目标单元格（IR contenteditable，失败静默）
  await nextTick()
  try {
    const tables = editorEl.value?.querySelectorAll('table')
    const table = tables?.[pos.tableIndex] as HTMLTableElement | undefined
    if (!table) return
    const targetDataRow =
      op === 'row-below' ? (pos.rowIndex < 0 ? 0 : pos.rowIndex + 1) : Math.max(0, pos.rowIndex)
    const tbody = table.querySelector('tbody')
    const rows = Array.from(
      (tbody ?? table).querySelectorAll('tr'),
    ) as HTMLTableRowElement[]
    const tr = rows[Math.min(targetDataRow, rows.length - 1)]
    if (!tr) return
    const cell = tr.children[Math.min(pos.colIndex, tr.children.length - 1)] as HTMLElement
    if (!cell) return
    const range = document.createRange()
    range.setStart(cell, 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  } catch (_) {
    /* 光标定位失败不影响表格更新 */
  }
}

function destroyEditor() {
  if (editorEl.value) {
    editorEl.value.removeEventListener('keydown', onKeydown)
    editorEl.value.removeEventListener('click', onEditorClick)
  }
  if (vditor) {
    try {
      vditor.destroy()
      logEditor.log('destroyEditor OK')
    } catch (_) {
      logEditor.warn('destroyEditor 异常已忽略')
    }
    vditor = null
  }
}

async function initEditor() {
  if (!props.note || !editorEl.value) {
    logEditor.warn('initEditor SKIP 无笔记或容器未就绪', {
      id: props.note?._id ?? null,
      elReady: Boolean(editorEl.value),
    })
    return
  }
  try {
    const Vditor = await loadVditor()
    logEditor.log('initEditor START', { id: props.note._id, readonly: props.readonly })
    vditor = new Vditor(editorEl.value, {
      mode: 'ir',
      cdn: VDITOR_CDN,
      cache: { enable: false },
      readonly: props.readonly,
      height: '100%',
      toolbar: props.readonly
        ? []
        : ['bold', 'italic', 'headings', 'list', 'link', 'code', 'table', '|', 'undo', 'redo'],
      toolbarConfig: { pin: true },
      counter: { enable: false },
      after: () => {
        if (vditor) vditor.setValue(props.note?.content || '', false)
        editorEl.value?.addEventListener('keydown', onKeydown)
        editorEl.value?.removeEventListener('click', onEditorClick)
        editorEl.value?.addEventListener('click', onEditorClick)
        currentStatus.value = 'idle'
        lastSavedTime.value = ''
        updateWordCount()
        logEditor.log('initEditor READY', props.note?._id)
      },
      input: () => {
        updateWordCount()
        scheduleSave()
      },
    })
  } catch (e: any) {
    logEditor.error('initEditor FAIL', e)
  }
}

// ---- lifecycle / watchers ----
onMounted(() => {
  logEditor.log('mounted', { id: props.note?._id ?? null, readonly: props.readonly })
  if (props.note) nextTick(initEditor)
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (savedRevertTimer) clearTimeout(savedRevertTimer)
  if (editorEl.value) editorEl.value.removeEventListener('keydown', onKeydown)
  destroyEditor()
  logEditor.log('unmounted')
})

watch(
  () => props.note,
  (newNote, oldNote) => {
    if (!newNote) {
      logEditor.log('note 变为空，保存并销毁编辑器')
      flushSave()
      destroyEditor()
      currentNoteId = null
      return
    }
    if (oldNote && newNote._id === oldNote._id) return
    logEditor.log('切换笔记', { from: oldNote?._id ?? null, to: newNote._id })
    flushSave()
    destroyEditor()
    currentNoteId = newNote._id
    nextTick(initEditor)
  },
)

watch(
  () => props.readonly,
  () => {
    if (!props.note) return
    flushSave()
    destroyEditor()
    nextTick(initEditor)
  },
)

watch(
  () => props.saveStatus,
  (val) => setStatus(val),
)

function onRetry() {
  emit('manual-save')
}

defineExpose({ vditor: () => vditor })
</script>

<style scoped>
.note-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.ne-tagbar {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  overflow-x: auto;
  white-space: nowrap;
  border-bottom: 1px solid #eee;
  box-sizing: border-box;
}

.ne-chip {
  display: inline-flex;
  align-items: center;
  background: #eef2f7;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 12px;
  color: #333;
}

.ne-chip-x {
  border: none;
  background: transparent;
  cursor: pointer;
  margin-left: 4px;
  color: #999;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.ne-chip-x:hover {
  color: #333;
}

.ne-tag-input {
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 12px;
  outline: none;
  width: 110px;
}

.ne-tag-add {
  border: none;
  background: transparent;
  color: #3b82f6;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.ne-editor {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.ne-vditor {
  height: 100%;
}

.ne-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 14px;
  text-align: center;
  padding: 0 16px;
}

.ne-statusbar {
  height: 32px;
  font-size: 12px;
  color: #666;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  box-sizing: border-box;
}

.ne-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ne-status.ne-saving {
  color: #d97706;
}

.ne-status.ne-saved {
  color: #16a34a;
}

.ne-status.ne-error {
  color: #dc2626;
  cursor: pointer;
}

.ne-save-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

:deep(.vditor-toolbar) {
  flex-wrap: nowrap;
  overflow-x: auto;
}

.ne-table-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
}

.ne-table-menu button {
  border: none;
  background: transparent;
  text-align: left;
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  color: #333;
  white-space: nowrap;
}

.ne-table-menu button:hover {
  background: #f1f5f9;
}

@media (max-width: 768px) {
  .ne-statusbar {
    font-size: 11px;
  }
  .ne-tagbar {
    -webkit-overflow-scrolling: touch;
  }
}
</style>
