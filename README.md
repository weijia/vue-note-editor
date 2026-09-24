# vue-note-editor

一个基于 [Vditor](https://github.com/Vanessa219/vditor)（IR 模式）的 Vue 3 `<NoteEditor>` 组件：标签条 + 防抖自动保存 + 底部状态栏。Vditor 在运行时通过 CDN 动态加载，库本身不捆绑 Vditor。

## 特性

- 标签条：渲染 `note.tags` 为 chip，可删除 / 添加（回车或按钮，自动去重）
- 编辑区：Vditor IR 模式，`autoSaveDelay` 防抖后 `emit('save')`
- 底部状态栏：实时字数、保存状态（保存中 / 已保存 / 失败可重试）、手动保存按钮
- `Ctrl/Cmd + S` 立即保存
- `note` 切换自动销毁并重建 Vditor 实例；`note` 为 `null` 时显示空状态
- 移动端适配（标签条 / 工具栏横滑、字号缩小）
- 纯 UI 组件：**不**做任何存储（PouchDB / Git / WebDAV）、不管理笔记列表、不处理冲突

## 安装

```bash
npm i vue-note-editor
```

Vue 3 为 peerDependency。

## 打包使用（推荐）

```ts
import { createApp } from 'vue'
import NoteEditor from 'vue-note-editor'
import 'vue-note-editor/style.css'

// 或命名导入： import { NoteEditor, type SidebarNote, type SaveStatus } from 'vue-note-editor'
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import NoteEditor from 'vue-note-editor'
import 'vue-note-editor/style.css'
import type { SidebarNote, SaveStatus } from 'vue-note-editor'

const note = ref<SidebarNote>({
  _id: '1', title: '标题', content: '# Hello', tags: ['todo'],
})
const saveStatus = ref<SaveStatus>('idle')

function onSave(content: string) {
  // 自己实现持久化
  saveStatus.value = 'saved'
}
</script>

<template>
  <NoteEditor
    :note="note"
    :auto-save-delay="1000"
    :readonly="false"
    :save-status="saveStatus"
    @save="onSave"
    @update-tags="(tags) => (note.tags = tags)"
    @manual-save="onSave"
    @save-state-change="(s) => (saveStatus = s)"
  />
</template>
```

## 网页直接调用（无需打包）

通过 [esm.sh](https://esm.sh) 即可在任意 HTML 页面中直接使用：

```html
<!doctype html>
<html>
  <body style="height:100vh;margin:0">
    <div id="app" style="height:100%"></div>
    <script type="module">
      import { createApp, h } from 'https://esm.sh/vue@3'
      import { NoteEditor } from 'https://esm.sh/vue-note-editor'
      import 'https://esm.sh/vue-note-editor/style.css'

      const note = { _id: '1', title: '标题', content: '# Hello' }
      createApp({
        render: () =>
          h(NoteEditor, {
            note,
            onSave: (c) => console.log('saved', c),
            onManualSave: () => console.log('manual save'),
          }),
      }).mount('#app')
    </script>
  </body>
</html>
```

> 也可使用 jsDelivr 直链 `https://cdn.jsdelivr.net/npm/vue-note-editor/dist/NoteEditor.mjs` 与 `.../dist/style.css`（需自行提供 Vue 的 ESM import 映射）。

## Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `note` | `SidebarNote \| null` | —（必填） | 当前笔记，`null` 显示空状态 |
| `autoSaveDelay` | `number` | `1000` | 自动保存防抖毫秒数 |
| `readonly` | `boolean` | `false` | 只读模式 |
| `saveStatus` | `'idle' \| 'saving' \| 'saved' \| 'error'` | `'idle'` | 由父组件驱动的保存状态（用于状态栏显示） |

`SidebarNote`:

```ts
interface SidebarNote {
  _id: string
  title: string
  content: string
  path?: string
  tags?: string[]
  updatedAt?: number
}
```

## Emits

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `save` | `(content: string)` | 防抖后或手动保存时触发，传出当前内容 |
| `update-tags` | `(tags: string[])` | 标签增删后传出新数组 |
| `save-state-change` | `(status)` | 保存状态变化（通常先 `saving`） |
| `manual-save` | — | 点击保存按钮 / `Ctrl/Cmd+S` 时触发 |

## 本地开发

```bash
cd vue-note-editor
npm install
npm run dev      # 启动演示页面
npm run build    # 构建到 dist/
```

## 发布到 npm（CI）

1. 在 GitHub 仓库 **Settings → Secrets → Actions** 添加 `NPM_TOKEN`（npm 上的 Automation / Publish token）。
2. 打 tag 推送即可触发发布：
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

## License

MIT
