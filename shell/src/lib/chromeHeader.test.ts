import { describe, expect, it } from 'vitest'
import { CHROME_HEADER_PROPERTY, publishChromeHeaderHeight } from './chromeHeader'

describe('publishChromeHeaderHeight', () => {
  it('sets the header height on the root, and ignores a header not laid out yet', () => {
    const root = { style: new Map<string, string>() }
    const element = { style: { setProperty: (name: string, value: string) => root.style.set(name, value) } }
    publishChromeHeaderHeight(0, element as unknown as HTMLElement)
    expect(root.style.size).toBe(0)
    publishChromeHeaderHeight(61, element as unknown as HTMLElement)
    expect(root.style.get(CHROME_HEADER_PROPERTY)).toBe('61px')
  })
})
