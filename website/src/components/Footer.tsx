export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer
      className="py-10 px-6 md:px-12"
      style={{ borderTop: '1px solid var(--hairline)' }}
    >
      <div
        className="max-w-[1280px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] tracking-caps"
        style={{ color: 'var(--muted)' }}
      >
        <div>© {year} DeepCuts</div>
        <a
          href="https://github.com/ibraude/deepcuts"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white transition-colors"
        >
          GitHub
        </a>
        <div>Made with care</div>
      </div>
    </footer>
  )
}
