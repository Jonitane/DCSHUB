const rendererRoot = new URL('.', window.location.href)

export function resolveAssetUrl(source?: string): string | undefined {
  if (!source || window.location.protocol !== 'file:' || !source.startsWith('/') || source.startsWith('//')) return source
  return new URL(source.slice(1), rendererRoot).href
}
