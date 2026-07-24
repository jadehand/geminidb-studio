import { useEffect, useLayoutEffect, useState } from 'react'
import type { TourStep } from './onboarding'

type Box = { top: number; left: number; width: number; height: number }

type Props = {
  steps: TourStep[]
  onComplete: () => void
  onSkip: () => void
}

const CARD_WIDTH = 300
const CARD_HEIGHT = 190
const GAP = 14

function targetBox(target: string): Box | null {
  const element = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function cardPosition(box: Box) {
  const margin = 12
  const maxLeft = Math.max(margin, window.innerWidth - CARD_WIDTH - margin)
  const below = box.top + box.height + GAP
  const top = below + CARD_HEIGHT <= window.innerHeight - margin
    ? below
    : Math.max(margin, box.top - CARD_HEIGHT - GAP)
  return {
    top,
    left: Math.min(maxLeft, Math.max(margin, box.left + box.width / 2 - CARD_WIDTH / 2))
  }
}

export default function FeatureTour({ steps, onComplete, onSkip }: Props) {
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const step = steps[index]

  useLayoutEffect(() => {
    const update = () => setBox(targetBox(step.target))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step.target])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip()
      if (event.key === 'Enter') index === steps.length - 1 ? onComplete() : setIndex(value => value + 1)
      if (event.key === 'ArrowLeft' && index > 0) setIndex(value => value - 1)
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [index, onComplete, onSkip, steps.length])

  if (!box) return null
  const position = cardPosition(box)

  return <div className="feature-tour" role="dialog" aria-modal="true" aria-labelledby="feature-tour-title">
    <div className="feature-tour-shade"/>
    <div className="feature-tour-focus" style={{ top:box.top - 5, left:box.left - 5, width:box.width + 10, height:box.height + 10 }}/>
    <section className="feature-tour-card" style={position}>
      <div className="feature-tour-progress"><span>{index + 1} / {steps.length}</span><button type="button" onClick={onSkip}>跳过</button></div>
      <h2 id="feature-tour-title">{step.title}</h2>
      <p>{step.description}</p>
      <div className="feature-tour-actions">
        <button type="button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>上一步</button>
        <button type="button" className="primary" onClick={() => index === steps.length - 1 ? onComplete() : setIndex(value => value + 1)}>
          {index === steps.length - 1 ? '开始使用' : '下一步'}
        </button>
      </div>
    </section>
  </div>
}
