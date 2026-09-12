// Cutting the dispatched screenshot into the pieces the class will reorder.
//
// This happens on the presenter's machine rather than on the server: the image
// is already here — it is the capture that was just taken — and a Deno function
// would need an image library to do what a canvas does in four lines.

export type Region = { box: number[]; label: string }

// Gemini returns [ymin, xmin, ymax, xmax] normalised to 0-1000.
function toPixels(box: number[], width: number, height: number, pad: number) {
  const [ymin, xmin, ymax, xmax] = box
  const left = (xmin / 1000) * width
  const top = (ymin / 1000) * height
  const right = (xmax / 1000) * width
  const bottom = (ymax / 1000) * height
  // The model boxes text tightly, and a tight box clips descenders and the last
  // stroke of a character. A little air costs nothing and keeps the tile legible.
  return {
    x: Math.max(0, Math.round(left - pad)),
    y: Math.max(0, Math.round(top - pad)),
    width: Math.min(width, Math.round(right + pad)) - Math.max(0, Math.round(left - pad)),
    height: Math.min(height, Math.round(bottom + pad)) - Math.max(0, Math.round(top - pad)),
  }
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取截圖。')) }
    image.src = url
  })
}

// One PNG per region, in the order the regions were given — which is the answer.
export async function sliceRegions(file: File, regions: Region[]): Promise<File[]> {
  const image = await loadImage(file)
  const pad = Math.round(Math.min(image.width, image.height) * 0.01)
  const slices: File[] = []

  for (const [index, region] of regions.entries()) {
    const rect = toPixels(region.box, image.width, image.height, pad)
    if (rect.width < 8 || rect.height < 8) continue
    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('無法建立圖片畫布。')
    // A white ground rather than transparent: these are read as paper, and a
    // transparent PNG turns into black text on black in a dark theme.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, rect.width, rect.height)
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('無法切出圖片。')
    slices.push(new File([blob], `slice-${index + 1}.png`, { type: 'image/png' }))
  }

  return slices
}

// The student's list holds plain text for a written ordering question and image
// URLs for a sliced one; this is how every renderer tells them apart.
export function isImageValue(value: string) {
  return /^https?:\/\//.test(value) && /\.(png|jpe?g|webp)(\?|$)/i.test(value)
}
