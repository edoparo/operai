import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { createContext, useContext, useEffect, useState } from 'react'

/** Turns an image's file id into a URL the browser can show (a short-lived presigned GET, a `blob:` URL). */
export type ResolveImageUrl = (fileId: string) => Promise<string>

export type RichTextImageCopy = {
  /** Shown while the URL is being fetched ("Loading image…"). */
  loading: string
  /** Shown instead of an image that cannot be shown ("Image not available"). */
  unavailable: string
}

type ImageProps = {
  fileId: string | null
  alt: string | null
  resolveUrl: ResolveImageUrl
  copy: RichTextImageCopy
  selected?: boolean
}

/**
 * One image of a document, by file id: the URL is asked for when it is shown, never stored, so a
 * document can only show files the app resolves (and a presigned URL that expired is simply asked
 * for again). Keyed by file id by its callers, so a new id starts from "loading".
 */
export function RichTextImage({ fileId, alt, resolveUrl, copy, selected = false }: ImageProps) {
  const [state, setState] = useState<{ url: string } | { failed: true } | null>(fileId ? null : { failed: true })

  useEffect(() => {
    if (!fileId) return
    let live = true
    resolveUrl(fileId).then(
      (url) => live && setState({ url }),
      () => live && setState({ failed: true }),
    )
    return () => {
      live = false
    }
  }, [fileId, resolveUrl])

  if (state && 'failed' in state) {
    return (
      <span className="rich-text-image-missing" role="img" aria-label={alt || copy.unavailable}>
        {copy.unavailable}
      </span>
    )
  }
  if (!state) {
    return (
      <span className="rich-text-image-missing" aria-busy="true">
        {copy.loading}
      </span>
    )
  }
  return (
    <img
      src={state.url}
      alt={alt ?? ''}
      className={selected ? 'rich-text-image rich-text-image-selected' : 'rich-text-image'}
      onError={() => setState({ failed: true })}
    />
  )
}

/** How the editor's image nodes find their URLs and copy: provided by `RichTextEditor` around its content. */
export const RichTextImageContext = createContext<{ resolveUrl: ResolveImageUrl; copy: RichTextImageCopy } | null>(null)

const noImages = { resolveUrl: () => Promise.reject(new Error('no image resolver')), copy: { loading: '', unavailable: '' } }

function ImageNodeView({ node, selected }: NodeViewProps) {
  const options = useContext(RichTextImageContext) ?? noImages
  const fileId = (node.attrs['fileId'] as string | null) ?? null
  return (
    <NodeViewWrapper as="div" className="rich-text-image-block" data-drag-handle>
      <RichTextImage
        key={fileId ?? 'none'}
        fileId={fileId}
        alt={(node.attrs['alt'] as string | null) ?? null}
        resolveUrl={options.resolveUrl}
        copy={options.copy}
        selected={selected}
      />
    </NodeViewWrapper>
  )
}

/**
 * The image node: a block that names a FILE by id (`attrs.fileId`) and never a URL. HTML pasted from
 * elsewhere does not become an image (only `img[data-file-id]` parses), so a document cannot make a
 * reader's browser fetch anything the app did not resolve.
 */
export const FileImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      fileId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-file-id'),
        renderHTML: (attributes) => ({ 'data-file-id': attributes['fileId'] as string | null }),
      },
      alt: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-file-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})
