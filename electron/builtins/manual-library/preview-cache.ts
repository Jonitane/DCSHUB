import fs from 'node:fs'
import path from 'node:path'
import { renderPageAsImage } from 'unpdf'
import type { ManualDocumentRecord, ManualPagePreview } from '../../../src/shared/manual-library-contracts'

function atomicWrite(filePath: string, contents: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents)
  fs.rmSync(filePath, { force: true })
  fs.renameSync(temporary, filePath)
}

async function cropPageWhitespace(png: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const image = await loadImage(png)
  const source = createCanvas(image.width, image.height)
  const sourceContext = source.getContext('2d')
  sourceContext.drawImage(image, 0, 0)
  const pixels = sourceContext.getImageData(0, 0, image.width, image.height).data
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const alpha = pixels[offset + 3]
      if (alpha <= 12 || (pixels[offset] >= 248 && pixels[offset + 1] >= 248 && pixels[offset + 2] >= 248)) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return png
  const padding = Math.max(14, Math.round(Math.min(image.width, image.height) * 0.018))
  left = Math.max(0, left - padding)
  top = Math.max(0, top - padding)
  right = Math.min(image.width - 1, right + padding)
  bottom = Math.min(image.height - 1, bottom + padding)
  const width = right - left + 1
  const height = bottom - top + 1
  if (width >= image.width * 0.98 && height >= image.height * 0.98) return png
  const cropped = createCanvas(width, height)
  const context = cropped.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, left, top, width, height, 0, 0, width, height)
  return cropped.toBuffer('image/png')
}

export class ManualPreviewCache {
  constructor(private readonly cacheDirectory: string, private readonly maximumBytes = 200 * 1024 * 1024) {}

  async render(document: ManualDocumentRecord, pageNumber: number, fingerprint: string): Promise<ManualPagePreview | null> {
    if (document.extension !== '.pdf' || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.pageCount) return null
    const cachePath = path.join(this.cacheDirectory, `${document.id}-${pageNumber}-${fingerprint.slice(0, 12)}-crop-v1.png`)
    let image: Buffer
    try {
      image = await fs.promises.readFile(cachePath)
      const now = new Date()
      await fs.promises.utimes(cachePath, now, now)
    } catch {
      const rendered = await renderPageAsImage(new Uint8Array(await fs.promises.readFile(document.sourcePath)), pageNumber, {
        canvasImport: () => import('@napi-rs/canvas'),
        width: 1_100,
      })
      image = await cropPageWhitespace(Buffer.from(rendered))
      atomicWrite(cachePath, image)
      this.trim(cachePath)
    }
    return {
      documentId: document.id,
      documentName: document.name,
      page: pageNumber,
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
    }
  }

  private trim(currentPath: string): void {
    try {
      const entries = fs.readdirSync(this.cacheDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
        .map((entry) => {
          const filePath = path.join(this.cacheDirectory, entry.name)
          const stat = fs.statSync(filePath)
          return { filePath, size: stat.size, mtimeMs: stat.mtimeMs }
        })
        .sort((left, right) => left.mtimeMs - right.mtimeMs)
      let total = entries.reduce((sum, entry) => sum + entry.size, 0)
      for (const entry of entries) {
        if (total <= this.maximumBytes) break
        if (path.resolve(entry.filePath) === path.resolve(currentPath)) continue
        fs.rmSync(entry.filePath, { force: true })
        total -= entry.size
      }
    } catch { /* Preview caching is best-effort and can be regenerated. */ }
  }
}
