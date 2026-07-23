import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { extractText, getDocumentProxy } from 'unpdf'

export interface ExtractedPage {
  page: number | null
  text: string
}

export interface ExtractedOutlineEntry {
  title: string
  page: number
  level: number
  path: string[]
}

export interface ExtractedDocument {
  pages: ExtractedPage[]
  outline: ExtractedOutlineEntry[]
}

export const SUPPORTED_MANUAL_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.markdown', '.html', '.htm', '.docx', '.epub', '.rtf'])

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
}

function stripMarkup(value: string): string {
  return decodeEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export class ManualDocumentParser {
  async parse(filePath: string): Promise<ExtractedDocument> {
    const extension = path.extname(filePath).toLocaleLowerCase()
    if (!SUPPORTED_MANUAL_EXTENSIONS.has(extension)) throw new Error(`不支持的手册格式：${extension || 'unknown'}`)
    if (extension === '.pdf') return this.parsePdf(filePath)
    if (extension === '.docx') {
      const zip = new AdmZip(filePath)
      const entry = zip.getEntry('word/document.xml')
      if (!entry) throw new Error('DOCX 中缺少 document.xml')
      const xml = entry.getData().toString('utf8').replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n').replace(/<\/w:p>/g, '\n')
      return { pages: [{ page: null, text: stripMarkup(xml) }], outline: [] }
    }
    if (extension === '.epub') {
      const zip = new AdmZip(filePath)
      const text = zip.getEntries()
        .filter((entry) => !entry.isDirectory && /\.(?:xhtml|html|htm)$/i.test(entry.entryName))
        .map((entry) => stripMarkup(entry.getData().toString('utf8')))
        .join('\n\n')
      return { pages: [{ page: null, text }], outline: [] }
    }
    const value = fs.readFileSync(filePath, 'utf8')
    if (['.html', '.htm'].includes(extension)) return { pages: [{ page: null, text: stripMarkup(value) }], outline: [] }
    if (extension === '.rtf') {
      return { pages: [{ page: null, text: value.replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\\[a-z]+-?\d* ?/gi, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() }], outline: [] }
    }
    return { pages: [{ page: null, text: value }], outline: [] }
  }

  private async parsePdf(filePath: string): Promise<ExtractedDocument> {
    const data = new Uint8Array(fs.readFileSync(filePath))
    const document = await getDocumentProxy(data)
    try {
      const [{ text }, outlineNodes] = await Promise.all([
        extractText(document, { mergePages: false }),
        document.getOutline().catch(() => []),
      ])
      const outline: ExtractedOutlineEntry[] = []
      const resolvePage = async (destination: string | Array<unknown> | null): Promise<number | null> => {
        if (!destination) return null
        const resolved = typeof destination === 'string' ? await document.getDestination(destination) : destination
        const target = resolved?.[0]
        if (typeof target === 'number') return target + 1
        if (!target || typeof target !== 'object') return null
        try { return (await document.getPageIndex(target as never)) + 1 } catch { return null }
      }
      const walk = async (nodes: typeof outlineNodes, parents: string[], level: number): Promise<void> => {
        for (const node of nodes || []) {
          const title = node.title.normalize('NFKC').replace(/\s+/g, ' ').trim()
          const currentPath = title ? [...parents, title] : parents
          const page = await resolvePage(node.dest)
          if (title && page) outline.push({ title, page, level, path: currentPath })
          if (node.items?.length) await walk(node.items, currentPath, level + 1)
        }
      }
      await walk(outlineNodes, [], 0)
      return {
        pages: text.map((pageText, index) => ({ page: index + 1, text: pageText })),
        outline: outline.sort((left, right) => left.page - right.page || left.level - right.level),
      }
    } finally {
      await document.destroy()
    }
  }
}
