import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export class ManualStorage {
  atomicWrite(filePath: string, contents: string | Buffer): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporaryPath, contents)
    fs.rmSync(filePath, { force: true })
    fs.renameSync(temporaryPath, filePath)
  }

  readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  }

  writeJson(filePath: string, value: unknown): void {
    this.atomicWrite(filePath, JSON.stringify(value, null, 2))
  }

  readCompressedJson<T>(filePath: string): T {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8')) as T
  }

  writeCompressedJson(filePath: string, value: unknown): void {
    this.atomicWrite(filePath, zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 6 }))
  }

  remove(filePath: string): void {
    fs.rmSync(filePath, { force: true })
  }
}
