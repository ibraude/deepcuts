export function Header() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-[60px] backdrop-blur-sm"
      style={{
        background: 'color-mix(in srgb, var(--bg) 80%, transparent)',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <div className="max-w-[1280px] mx-auto h-full flex items-center justify-between px-6 md:px-12">
        <a href="#top" className="tracking-caps text-xs" style={{ color: 'var(--ink)' }}>
          DeepCuts
        </a>
        <a
          href="#download"
          className="tracking-caps text-xs hover:text-white transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          Download for Mac
        </a>
      </div>
    </header>
  )
}
