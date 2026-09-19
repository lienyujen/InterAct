import { useRef } from 'react'

export type Pin = { x: number; y: number; label: string; own?: boolean; color?: string }

type Props = {
  imageUrl: string
  alt: string
  pins: Pin[]
  // Omitted on the presenter's copy, which is a picture of what the class did
  // rather than somewhere to answer.
  onPlace?: (point: { x: number; y: number }) => void
  onRemove?: (index: number) => void
}

// Positions are stored as fractions of the image, never as pixels: the class
// answers on phones and the presenter reads it on a projector, and a pixel
// recorded on one is meaningless on the other.
export function HotspotImage({ imageUrl, alt, pins, onPlace, onRemove }: Props) {
  const frameRef = useRef<HTMLDivElement>(null)

  function place(event: React.MouseEvent<HTMLDivElement>) {
    if (!onPlace) return
    const frame = frameRef.current
    if (!frame) return
    const box = frame.getBoundingClientRect()
    if (!box.width || !box.height) return
    onPlace({
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    })
  }

  return (
    <div
      className={`hotspot-frame${onPlace ? ' is-answerable' : ''}`}
      ref={frameRef}
      role={onPlace ? 'button' : undefined}
      tabIndex={onPlace ? 0 : undefined}
      onClick={place}
    >
      <img alt={alt} className="hotspot-image" src={imageUrl} />
      {pins.map((pin, index) => (
        <button
          className={`hotspot-pin${pin.own ? ' is-own' : ''}`}
          disabled={!onRemove}
          key={`${index}-${pin.x}-${pin.y}`}
          // The colour reaches the point of the pin as well as its head, and the
          // point is drawn by a pseudo-element, so it travels as a variable.
          style={{
            left: `${pin.x * 100}%`,
            top: `${pin.y * 100}%`,
            ...(pin.color ? { '--pin-color': pin.color } as React.CSSProperties : {}),
          }}
          title={pin.label}
          type="button"
          onClick={(event) => {
            // Otherwise removing a pin would drop a new one underneath it.
            event.stopPropagation()
            onRemove?.(index)
          }}
        >
          <span>{pin.label}</span>
        </button>
      ))}
    </div>
  )
}
