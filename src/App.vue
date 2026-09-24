<template>
  <div style="height: 100vh; padding: 16px; box-sizing: border-box">
    <NoteEditor
      :note="note"
      :auto-save-delay="1000"
      :readonly="readonly"
      :save-status="saveStatus"
      @save="onSave"
      @update-tags="onTags"
      @manual-save="onManual"
      @save-state-change="onState"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import NoteEditor from './NoteEditor.vue'
import type { SidebarNote, SaveStatus } from './types'

const note = ref<SidebarNote>({
  _id: '1',
  title: '测试笔记',
  content: '# 你好\n\n这是一段 **Markdown** 内容。',
  tags: ['todo', 'idea'],
  updatedAt: Date.now(),
})

const readonly = ref(false)
const saveStatus = ref<SaveStatus>('idle')

function simulateSave() {
  // 模拟异步保存到后端
  setTimeout(() => {
    saveStatus.value = 'saved'
  }, 500)
}

function onSave(content: string) {
  const n = note.value
  note.value = { ...n, content, updatedAt: Date.now() }
  simulateSave()
}

function onTags(tags: string[]) {
  note.value = { ...note.value, tags }
}

function onManual() {
  simulateSave()
}

function onState(_s: SaveStatus) {
  // 父组件可以通过 saveStatus prop 驱动状态栏显示
}
</script>
