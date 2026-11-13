import type { JSONContent } from '@tiptap/core'

/** Every image node's file id, in document order, without duplicates. */
export function imageFileIds(doc: JSONContent | null | undefined): string[] {
  const ids: string[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image' && typeof node.attrs?.['fileId'] === 'string') ids.push(node.attrs['fileId'] as string)
    node.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return [...new Set(ids)]
}

/**
 * The document with each image's file id passed through `map`: a new id replaces it, `null` removes
 * the image. For a document written before its record existed (local ids → stored ids).
 */
export function mapImageFileIds(doc: JSONContent, map: (fileId: string) => string | null): JSONContent {
  const visit = (node: JSONContent): JSONContent | null => {
    if (node.type === 'image') {
      const current = node.attrs?.['fileId']
      const next = typeof current === 'string' ? map(current) : null
      return next === null ? null : { ...node, attrs: { ...node.attrs, fileId: next } }
    }
    if (!node.content) return node
    return { ...node, content: node.content.map(visit).filter((child): child is JSONContent => child !== null) }
  }
  return visit(doc) ?? { type: 'doc', content: [] }
}

/** True when the document has no text (other than whitespace) and no image. */
export function isEmptyRichText(doc: JSONContent | null | undefined): boolean {
  const filled = (node: JSONContent): boolean =>
    node.type === 'image' ||
    (typeof node.text === 'string' && node.text.trim() !== '') ||
    (node.content ?? []).some(filled)
  return !doc || !filled(doc)
}
