import { motion } from 'framer-motion'
import { heroLineVariants, heroLineTransition } from '../lib/motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { EpisodeView } from '../catalog/fetchCatalog'

const HEADLINE_LINES = ['Listening documentaries', 'for music fans.']

export function Hero({ featured }: { featured: EpisodeView | null }) {
  const reduced = useReducedMotion()

  return (
    <section className="min-h-screen flex items-center pt-[120px] pb-24 px-6 md:px-12">
      <div className="max-w-[1280px] mx-auto grid md:grid-cols-2 gap-16 items-center w-full">
        <div>
          <div className="tracking-caps text-xs mb-6" style={{ color: 'var(--muted)' }}>
            A music fan podcast
          </div>
          <h1 className="font-display text-[44px] md:text-[72px] leading-[1.02] tracking-[-0.01em]">
            {HEADLINE_LINES.map((line, i) => (
              <motion.span
                key={line}
                className="block"
                initial={reduced ? { opacity: 0 } : 'hidden'}
                animate={reduced ? { opacity: 1 } : 'shown'}
                variants={reduced ? undefined : heroLineVariants}
                transition={reduced ? { duration: 0.2 } : heroLineTransition(i)}
              >
                {line}
              </motion.span>
            ))}
          </h1>
          <motion.p
            className="italic mt-8 text-[15px] max-w-md"
            style={{ color: 'var(--muted)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 0.9 }}
          >
            Deep albums. Real stories. Timeless music.
          </motion.p>
          <motion.div
            className="mt-10 flex flex-col md:flex-row items-start md:items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: reduced ? 0 : 1.1 }}
          >
            <a
              href="#download"
              className="tracking-caps text-xs px-5 py-3 rounded-full transition-colors"
              style={{ background: 'var(--ink)', color: 'var(--bg)' }}
            >
              Download for Mac ↓
            </a>
            <span className="tracking-caps text-[10px]" style={{ color: 'var(--muted)' }}>
              macOS · requires Spotify
            </span>
          </motion.div>
        </div>
        <motion.div
          initial={
            reduced ? { opacity: 0 } : { opacity: 0, filter: 'blur(20px)', scale: 1.04 }
          }
          animate={
            reduced ? { opacity: 1 } : { opacity: 1, filter: 'blur(0px)', scale: 1 }
          }
          transition={{ duration: 0.8, delay: reduced ? 0 : 0.2 }}
          className="justify-self-center md:justify-self-end"
        >
          {featured ? (
            <img
              src={featured.coverUrl}
              alt={`${featured.meta.artistName} — ${featured.meta.albumName}`}
              className="block max-w-[480px] w-full aspect-square object-cover"
              style={{ transform: 'rotate(2deg)' }}
              draggable={false}
            />
          ) : (
            <div className="w-[320px] h-[320px]" style={{ background: 'var(--surface)' }} />
          )}
        </motion.div>
      </div>
    </section>
  )
}
