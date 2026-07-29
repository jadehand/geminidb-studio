import { useEffect, useRef } from 'react'

export type MeasurementActionAnchor = { x:number; y:number }

type Props = {
  anchor: MeasurementActionAnchor
  measurement: string
  onViewData: () => void
  onNewQuery: () => void
  onViewSchema: () => void
  onClose: () => void
}

const MENU_WIDTH = 176
const MENU_HEIGHT = 120
const VIEWPORT_GUTTER = 8

export default function MeasurementActionMenu({ anchor, measurement, onViewData, onNewQuery, onViewSchema, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const actions = [onViewData, onNewQuery, onViewSchema]
  const left = Math.max(VIEWPORT_GUTTER, Math.min(anchor.x, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER))
  const top = Math.max(VIEWPORT_GUTTER, Math.min(anchor.y, window.innerHeight - MENU_HEIGHT - VIEWPORT_GUTTER))

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', closeOutside)
    itemRefs.current[0]?.focus()
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [onClose])

  function run(index: number) {
    actions[index]()
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const index = itemRefs.current.findIndex(item => item === event.currentTarget)
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (index + (event.key === 'ArrowDown' ? 1 : actions.length - 1)) % actions.length
      itemRefs.current[next]?.focus()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      run(index)
    }
  }

  const items = [
    ['查看数据', onViewData],
    ['新建查询', onNewQuery],
    ['查看 Schema', onViewSchema],
  ] as const

  return <div ref={menuRef} className="measurement-action-menu" role="menu" aria-label={`${measurement} 操作`} style={{ left, top }}>
    {items.map(([label], index) => <button key={label} ref={element => { itemRefs.current[index] = element }} type="button" role="menuitem" onClick={() => run(index)} onKeyDown={onKeyDown}>{label}</button>)}
  </div>
}
