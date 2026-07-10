import { RevealOnScroll } from './RevealOnScroll'

export function About() {
  return (
    <section className="py-24 md:py-40 px-6 md:px-12">
      <div className="max-w-[640px] mx-auto text-center space-y-8">
        <RevealOnScroll>
          <div className="tracking-caps text-xs" style={{ color: 'var(--muted)' }}>
            What it is
          </div>
        </RevealOnScroll>
        <RevealOnScroll delay={0.06}>
          <p className="text-[17px] leading-relaxed" style={{ color: 'var(--ink)' }}>
            DeepCuts is a macOS app that plays AI-narrated listening documentaries
            about the records that shape a life. Narration alternates with the actual
            songs, so you hear the album as you learn its story.
          </p>
        </RevealOnScroll>
        <RevealOnScroll delay={0.12}>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            The songs play through your own Spotify desktop app — DeepCuts just tells
            it what to play next. No accounts, no Spotify Web API, no server. Everything
            runs on your Mac.
          </p>
        </RevealOnScroll>
        <RevealOnScroll delay={0.18}>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            macOS only for now. Requires the Spotify desktop app installed and signed in.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  )
}
