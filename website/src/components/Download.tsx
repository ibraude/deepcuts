import { RevealOnScroll } from './RevealOnScroll'

const DOWNLOAD_URL =
  (import.meta.env.VITE_DOWNLOAD_URL as string | undefined) ||
  'https://github.com/ibraude/deepcuts/releases/latest'

const DOWNLOAD_VERSION =
  (import.meta.env.VITE_DOWNLOAD_VERSION as string | undefined) || 'latest'

export function Download() {
  return (
    <section id="download" className="py-24 md:py-40 px-6 md:px-12">
      <div className="max-w-[640px] mx-auto text-center">
        <RevealOnScroll>
          <div className="tracking-caps text-xs mb-6" style={{ color: 'var(--muted)' }}>
            Download
          </div>
          <h2 className="font-display text-[36px] md:text-[54px] leading-[1.02] tracking-[-0.01em] mb-8">
            Get DeepCuts<br />for Mac.
          </h2>
          <a
            href={DOWNLOAD_URL}
            className="inline-block tracking-caps text-xs px-6 py-3 rounded-full transition-colors"
            style={{ background: 'var(--ink)', color: 'var(--bg)' }}
          >
            Download {DOWNLOAD_VERSION} ↓
          </a>
          <div className="tracking-caps text-[10px] mt-6" style={{ color: 'var(--muted)' }}>
            macOS · requires Spotify
          </div>
          <a
            href="https://github.com/ibraude/deepcuts#readme"
            className="text-[13px] mt-4 inline-block hover:text-white transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            or run from source →
          </a>
        </RevealOnScroll>
      </div>
    </section>
  )
}
