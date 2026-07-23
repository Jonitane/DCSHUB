import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isMessageKey,
  normalizeLanguage,
  translateMessage,
  translateStaticText,
  type AppLanguage,
  type MessageKey,
  type MessageParameters,
} from './i18n-core'

interface LanguageContextValue {
  language: AppLanguage
  setLanguage(language: AppLanguage): void
  toggleLanguage(): void
  t(key: MessageKey, parameters?: MessageParameters): string
  text(value: string): string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)
const originalText = new WeakMap<Text, string>()
const originalAttributes = new WeakMap<Element, Map<string, string>>()
const TRANSLATED_ATTRIBUTES = ['aria-label', 'title', 'placeholder'] as const

function shouldIgnore(element: Element | null): boolean {
  return Boolean(element?.closest('[data-i18n-ignore="true"], script, style, code, pre'))
}

function localizeTextNode(node: Text, language: AppLanguage): void {
  if (shouldIgnore(node.parentElement)) return
  const current = node.nodeValue || ''
  if (language === 'zh-CN') {
    const source = originalText.get(node)
    if (source !== undefined && current !== source) node.nodeValue = source
    return
  }
  let source = originalText.get(node)
  const containsSourceLanguage = /[\p{Script=Han}]/u.test(current)
  if (source === undefined && !containsSourceLanguage) return
  if (source === undefined || containsSourceLanguage) {
    source = current
    originalText.set(node, source)
  }
  const translated = translateStaticText(source, language)
  if (translated !== current) node.nodeValue = translated
}

function localizeElement(element: Element, language: AppLanguage): void {
  if (shouldIgnore(element)) return
  let sources = originalAttributes.get(element)
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const current = element.getAttribute(attribute)
    if (current === null) continue
    if (language === 'zh-CN') {
      const source = sources?.get(attribute)
      if (source !== undefined && current !== source) element.setAttribute(attribute, source)
      continue
    }
    if (!sources) {
      sources = new Map()
      originalAttributes.set(element, sources)
    }
    let source = sources.get(attribute)
    const containsSourceLanguage = /[\p{Script=Han}]/u.test(current)
    if (source === undefined && !containsSourceLanguage) continue
    if (source === undefined || containsSourceLanguage) {
      source = current
      sources.set(attribute, source)
    }
    const translated = translateStaticText(source, language)
    if (translated !== current) element.setAttribute(attribute, translated)
  }
}

function localizeTree(root: Node, language: AppLanguage): void {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text, language)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) localizeElement(root as Element, language)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) localizeTextNode(current as Text, language)
    else localizeElement(current as Element, language)
    current = walker.nextNode()
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    try { return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)) }
    catch { return DEFAULT_LANGUAGE }
  })

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next)
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next) } catch { /* Ignore unavailable storage. */ }
  }, [])
  const toggleLanguage = useCallback(() => setLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN'), [language, setLanguage])
  const t = useCallback((key: MessageKey, parameters?: MessageParameters) => translateMessage(key, language, parameters), [language])
  const text = useCallback((value: string) => isMessageKey(value) ? translateMessage(value, language) : translateStaticText(value, language), [language])

  useEffect(() => {
    document.documentElement.lang = language
    localizeTree(document.body, language)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') localizeTree(mutation.target, language)
        else if (mutation.type === 'attributes') localizeElement(mutation.target as Element, language)
        else for (const node of mutation.addedNodes) localizeTree(node, language)
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...TRANSLATED_ATTRIBUTES] })
    return () => observer.disconnect()
  }, [language])

  const value = useMemo(() => ({ language, setLanguage, toggleLanguage, t, text }), [language, setLanguage, toggleLanguage, t, text])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useI18n must be used within LanguageProvider')
  return context
}
