// 在 Markdown 文本层面操作表格（Vditor IR 模式 getValue() 返回的就是 Markdown）。
// 不依赖 Vditor 内置的浮动表格工具条——IR 模式官方根本没有行列操作菜单，这里自建。
//
// 设计要点：
// - 去除 IR 模式的零宽字符 \u200b 后再解析（Vditor 渲染时自动重新加，传纯 Markdown 给 setValue 即可）。
// - 表格块 = 表头行 + 分隔行（|---|）+ 连续数据行。
// - 列数按最大列数规范化补齐，分隔行缺失时填充 ---。
// - 单元格按 '|' 切分；不处理单元格内转义的 \|（常见笔记表格不含，后续可增强）。

export interface TablePosition {
  tableIndex: number // 第几个表格（0-based）
  rowIndex: number // 数据行索引（0-based）；-1 表示点击的是表头（即“数据区最前”）
  colIndex: number // 列索引（0-based）
}

export type TableOp =
  | 'row-above'
  | 'row-below'
  | 'col-left'
  | 'col-right'
  | 'del-row'
  | 'del-col'

interface TableBlock {
  startLine: number // 表头行号
  endLine: number // 最后数据行号
  header: string[]
  separator: string[]
  rows: string[][]
  colCount: number
}

function clean(md: string): string {
  return md.replace(/\u200b/g, '') // 去除 IR 模式的零宽字符
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  const cells = splitCells(line)
  if (cells.length === 0) return false
  return cells.every((c) => /^:?-+:?$/.test(c.trim()))
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.includes('|')
}

function splitCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function joinRow(cells: string[]): string {
  return '| ' + cells.join(' | ') + ' |'
}

function findTables(lines: string[]): TableBlock[] {
  const blocks: TableBlock[] = []
  let i = 0
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitCells(lines[i])
      const separator = splitCells(lines[i + 1])
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(splitCells(lines[j]))
        j++
      }
      const colCount = Math.max(
        header.length,
        separator.length,
        ...rows.map((r) => r.length),
        1,
      )
      blocks.push({ startLine: i, endLine: j - 1, header, separator, rows, colCount })
      i = j
    } else {
      i++
    }
  }
  return blocks
}

function normalize(block: TableBlock): void {
  const n = block.colCount
  const pad = (cells: string[]): string[] => {
    const out = cells.slice(0, n)
    while (out.length < n) out.push('')
    return out
  }
  block.header = pad(block.header)
  block.separator = pad(block.separator)
  if (block.separator.every((c) => c === '')) {
    block.separator = block.header.map(() => '---')
  }
  block.rows = block.rows.map(pad)
}

/**
 * 根据位置与操作类型，返回编辑后的 Markdown；无法操作（如越界、删空表）返回 null。
 */
export function editTable(md: string, pos: TablePosition, op: TableOp): string | null {
  const cleaned = clean(md)
  const lines = cleaned.split('\n')
  const blocks = findTables(lines)
  const block = blocks[pos.tableIndex]
  if (!block) return null
  normalize(block)

  const n = block.colCount
  const emptyCells = () => Array.from({ length: n }, () => '')
  const sepCells = () => Array.from({ length: n }, () => '---')
  const dataIdx = pos.rowIndex // -1 或 0..rows.length-1

  switch (op) {
    case 'row-above': {
      if (dataIdx < 0) return null // 表头不能上插
      block.rows.splice(dataIdx, 0, emptyCells())
      break
    }
    case 'row-below': {
      const at = dataIdx < 0 ? 0 : dataIdx + 1
      block.rows.splice(at, 0, emptyCells())
      break
    }
    case 'del-row': {
      if (dataIdx < 0) return null
      if (block.rows.length <= 1) return null // 不能删到空表
      block.rows.splice(dataIdx, 1)
      break
    }
    case 'col-left': {
      for (const r of block.rows) r.splice(pos.colIndex, 0, '')
      block.header.splice(pos.colIndex, 0, '')
      block.separator.splice(pos.colIndex, 0, '---')
      break
    }
    case 'col-right': {
      const at = pos.colIndex + 1
      for (const r of block.rows) r.splice(at, 0, '')
      block.header.splice(at, 0, '')
      block.separator.splice(at, 0, '---')
      break
    }
    case 'del-col': {
      if (n <= 1) return null
      for (const r of block.rows) r.splice(pos.colIndex, 1)
      block.header.splice(pos.colIndex, 1)
      block.separator.splice(pos.colIndex, 1)
      break
    }
    default:
      return null
  }

  const blockLines: string[] = []
  blockLines.push(joinRow(block.header))
  blockLines.push(joinRow(block.separator))
  for (const row of block.rows) blockLines.push(joinRow(row))

  const newLines = lines.slice()
  newLines.splice(block.startLine, block.endLine - block.startLine + 1, ...blockLines)
  return newLines.join('\n')
}
