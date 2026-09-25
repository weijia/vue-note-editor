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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { SidebarNote, SaveStatus } from './types'
import { logEditor } from './debug'

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

const VDITOR_CSS = 'https://unpkg.com/vditor@3/dist/index.css'
const VDITOR_JS = 'https://unpkg.com/vditor@3/dist/index.min.js'
const VDITOR_CDN = 'https://unpkg.com/vditor@3/dist'

const editorEl = ref<HTMLElement | null>(null)
const tagInput = ref('')
const currentStatus = ref<SaveStatus>(props.saveStatus)
const lastSavedTime = ref('')
const wordCount = ref(0)

let vditor: any = null
let vditorPromise: Promise<any> | null = null
let debounceTimer: number | null = null
let savedRevertTimer: number | null = null
let currentNoteId: string | null = props.note ? props.note._id : null

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
  logEditor.log('loadVditor START', VDITOR_JS)
  vditorPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = VDITOR_CSS
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = VDITOR_JS
    script.async = true
    script.onload = () => {
      logEditor.log('loadVditor OK')
      resolve((window as any).Vditor)
    }
    script.onerror = () => {
      const err = new Error('Failed to load Vditor from CDN')
      logEditor.error('loadVditor FAIL', VDITOR_JS, err)
      reject(err)
    }
    document.head.appendChild(script)
  })
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

function destroyEditor() {
  if (editorEl.value) editorEl.value.removeEventListener('keydown', onKeydown)
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

@media (max-width: 768px) {
  .ne-statusbar {
    font-size: 11px;
  }
  .ne-tagbar {
    -webkit-overflow-scrolling: touch;
  }
}
</style>
