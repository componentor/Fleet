/**
 * Lightweight markdown renderer for status page posts.
 * Handles a subset of markdown: headings, bold, italic, code,
 * links, lists, blockquotes, and paragraphs.
 * Content is HTML-escaped before transforms to prevent XSS.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md)
  const lines = escaped.split('\n')
  const html: string[] = []
  let inList = false
  let inBlockquote = false
  let paragraph: string[] = []

  function flushParagraph() {
    if (paragraph.length) {
      html.push(`<p>${paragraph.join(' ')}</p>`)
      paragraph = []
    }
  }

  function flushList() {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  function flushBlockquote() {
    if (inBlockquote) {
      html.push('</blockquote>')
      inBlockquote = false
    }
  }

  function inlineFormat(text: string): string {
    return text
      // Code (inline) — must come before bold/italic
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links [text](url)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Empty line: flush current block
    if (!trimmed) {
      flushParagraph()
      flushList()
      flushBlockquote()
      continue
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      flushBlockquote()
      const level = headingMatch[1]!.length
      html.push(`<h${level}>${inlineFormat(headingMatch[2]!)}</h${level}>`)
      continue
    }

    // Unordered list items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph()
      flushBlockquote()
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`)
      continue
    }

    // Blockquote
    if (trimmed.startsWith('&gt; ')) {
      flushParagraph()
      flushList()
      if (!inBlockquote) {
        html.push('<blockquote>')
        inBlockquote = true
      }
      html.push(`<p>${inlineFormat(trimmed.slice(5))}</p>`)
      continue
    }

    // Regular text: collect into paragraph
    flushList()
    flushBlockquote()
    paragraph.push(inlineFormat(trimmed))
  }

  flushParagraph()
  flushList()
  flushBlockquote()

  return html.join('\n')
}
