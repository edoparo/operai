import { formatNumber } from '@operai/ui'
import { strings } from '../../strings'

/** What a browser reports as no type (or a generic one) for common documents, by extension. */
export const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** The content type to declare for a file: the browser's own, else from the extension, else null. */
export function contentTypeOf(file: Pick<File, 'name' | 'type'>): string | null {
  if (file.type !== '' && file.type !== 'application/octet-stream') return file.type
  const extension = file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : ''
  return TYPE_BY_EXTENSION[extension] ?? null
}

/** The `accept` list: every accepted type, plus the extensions that map to one (browsers differ on `.md`). */
export function acceptList(contentTypes: string[]): string {
  const allowed = new Set(contentTypes)
  const extensions = Object.entries(TYPE_BY_EXTENSION)
    .filter(([, type]) => allowed.has(type))
    .map(([extension]) => `.${extension}`)
  return [...contentTypes, ...extensions].join(',')
}

export type FileRefusal = 'unsupportedType' | 'tooLarge' | 'empty'

/** The pre-check a file passes before any request; the server decides again. */
export function refusalOf(
  file: Pick<File, 'name' | 'type' | 'size'>,
  limits: { contentTypes: string[]; maxFileBytes: number },
): FileRefusal | null {
  const type = contentTypeOf(file)
  if (type === null || !limits.contentTypes.includes(type)) return 'unsupportedType'
  if (file.size === 0) return 'empty'
  if (file.size > limits.maxFileBytes) return 'tooLarge'
  return null
}

/** Parsed http(s) URL, or null: the only schemes a link may be written with or rendered as a link. */
export function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** The size in the language, in binary steps as file managers show them. */
export function formatFileSize(bytes: number): string {
  const unit = strings.attachments.size
  const KB = 1024
  const [value, name] =
    bytes < KB
      ? [bytes, unit.byte]
      : bytes < KB ** 2
        ? [bytes / KB, unit.kilobyte]
        : bytes < KB ** 3
          ? [bytes / KB ** 2, unit.megabyte]
          : [bytes / KB ** 3, unit.gigabyte]
  return `${formatNumber(value, { maximumFractionDigits: name === unit.byte ? 0 : 1 })} ${name}`
}
