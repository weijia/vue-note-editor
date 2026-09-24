export interface SidebarNote {
  _id: string
  title: string
  content: string
  path?: string
  tags?: string[]
  updatedAt?: number
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
