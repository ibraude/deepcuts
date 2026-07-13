import { useState } from 'react'
import { useEditorStore } from '../editorStore'
import type { DraftManifest } from '../../../shared/manifest'
import { FormField, inputClass } from './FormField'
import { CollapsibleRow } from './CollapsibleRow'
import { VoiceoverEditor } from './VoiceoverEditor'
import { VoiceoverTimeline } from './VoiceoverTimeline'

// Canonical Spotify track URIs have exactly 22 base62 characters after the prefix.
const SPOTIFY_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/

// Accept anything the Spotify desktop/web app might hand the user:
//   - spotify:track:XXX (already canonical)
//   - https://open.spotify.com/track/XXX
//   - https://open.spotify.com/track/XXX?si=abc123 (share URL with tracking)
//   - open.spotify.com/intl-de/track/XXX (localized share URL variant)
//   - a bare 22-char base62 id pasted alone
// Anything else is returned unchanged so the invalid-state indicator still fires.
function normalizeSpotifyUriInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  const prefixed = trimmed.match(/(?:spotify:track:|open\.spotify\.com\/(?:[a-z-]+\/)?track\/)([A-Za-z0-9]{22})/)
  if (prefixed) return `spotify:track:${prefixed[1]}`
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return `spotify:track:${trimmed}`
  return trimmed
}

type SongSegment = Extract<DraftManifest['chapters'][number]['segments'][number], { type: 'song' }>
type Voiceover = NonNullable<SongSegment['voiceovers']>[number]

interface Props {
  chapterIndex: number
  segmentIndex: number
}

export function SongSegmentEditor({ chapterIndex, segmentIndex }: Props) {
  const draftMaybe = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  const [openVoIdx, setOpenVoIdx] = useState<number | null>(null)
  if (!draftMaybe) return null
  const draft: DraftManifest = draftMaybe
  const segRaw = draft.chapters[chapterIndex]?.segments[segmentIndex]
  if (!segRaw || segRaw.type !== 'song') return null
  const seg: SongSegment = segRaw

  function setSegField(patch: Partial<SongSegment>) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, ci) =>
        ci !== chapterIndex
          ? c
          : {
              ...c,
              segments: c.segments.map((s, si) =>
                si !== segmentIndex || s.type !== 'song' ? s : { ...s, ...patch },
              ),
            },
      ),
    }))
  }

  function setTrack(patch: Partial<SongSegment['track']>) {
    setSegField({ track: { ...seg.track, ...patch } })
  }

  function addVoiceover() {
    const newVo: Voiceover = {
      id: `vo${Date.now()}`,
      hostId: draft.hosts[0]?.id ?? 'host_a',
      text: '',
      atSeconds: 0,
      duckTo: 60,
      holdDuck: false,
    }
    const newVoiceovers = [...(seg.voiceovers ?? []), newVo]
    setOpenVoIdx(newVoiceovers.length - 1)
    setSegField({ voiceovers: newVoiceovers })
  }
  function removeVoiceover(idx: number) {
    if (openVoIdx === idx) setOpenVoIdx(null)
    setSegField({ voiceovers: (seg.voiceovers ?? []).filter((_, i) => i !== idx) })
  }
  function setVoiceoverAtSeconds(idx: number, atSec: number) {
    setSegField({
      voiceovers: (seg.voiceovers ?? []).map((v, i) => (i === idx ? { ...v, atSeconds: atSec } : v)),
    })
  }

  const uriInvalid = seg.track.spotifyUri.length > 0 && !SPOTIFY_URI_RE.test(seg.track.spotifyUri)
  const voiceovers = seg.voiceovers ?? []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Track title">
          <input value={seg.track.title} onChange={(e) => setTrack({ title: e.target.value })} className={inputClass()} />
        </FormField>
        <FormField label="Artist">
          <input value={seg.track.artist} onChange={(e) => setTrack({ artist: e.target.value })} className={inputClass()} />
        </FormField>
      </div>
      <FormField
        label="Spotify URI"
        hint="Paste any Spotify link — the share URL (open.spotify.com/track/…), the URI (spotify:track:…), or just the 22-char ID — and it'll clean itself up."
      >
        <input
          value={seg.track.spotifyUri}
          onChange={(e) => setTrack({ spotifyUri: normalizeSpotifyUriInput(e.target.value) })}
          onPaste={(e) => {
            // Normalize on paste explicitly so multi-piece paste (URL + query
            // string) collapses to the canonical URI before any keystroke.
            const pasted = e.clipboardData.getData('text')
            const normalized = normalizeSpotifyUriInput(pasted)
            if (normalized !== pasted) {
              e.preventDefault()
              setTrack({ spotifyUri: normalized })
            }
          }}
          className={inputClass(uriInvalid) + ' font-mono'}
          placeholder="spotify:track:… or paste a Spotify share URL"
        />
      </FormField>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Start at (s)">
          <input
            type="number"
            min={0}
            step={1}
            value={seg.startAtSeconds}
            onChange={(e) => setSegField({ startAtSeconds: Number(e.target.value) || 0 })}
            className={inputClass()}
          />
        </FormField>
        <FormField label="Play seconds">
          <input
            type="number"
            min={1}
            step={1}
            value={seg.playSeconds}
            onChange={(e) => setSegField({ playSeconds: Number(e.target.value) || 1 })}
            className={inputClass()}
          />
        </FormField>
        <FormField label="Why this track">
          <input value={seg.why ?? ''} onChange={(e) => setSegField({ why: e.target.value })} className={inputClass()} />
        </FormField>
      </div>

      <div className="pt-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)]">Voiceovers</div>
          <button
            onClick={addVoiceover}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            + Voiceover
          </button>
        </div>
        {voiceovers.length === 0 ? (
          <div className="text-xs text-[var(--color-muted)] py-2 italic">No voiceovers.</div>
        ) : (
          <div>
            <VoiceoverTimeline
              voiceovers={voiceovers}
              totalSec={Math.max(seg.playSeconds, 60)}
              activeIdx={openVoIdx}
              onActivate={(idx) => setOpenVoIdx((cur) => (cur === idx ? null : idx))}
              onAtSecondsChange={setVoiceoverAtSeconds}
            />
            {voiceovers.map((vo, voIdx) => {
              const isOpen = openVoIdx === voIdx
              const hostName = draft.hosts.find((h) => h.id === vo.hostId)?.name ?? vo.hostId
              const summary = (
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-xs text-[var(--color-muted)] shrink-0 font-mono">
                    {vo.atSeconds}s
                  </span>
                  <span className="text-sm text-[var(--color-text)] shrink-0">{hostName}</span>
                  {vo.holdDuck && (
                    <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-accent)] shrink-0">
                      hold
                    </span>
                  )}
                  <span className="text-sm text-[var(--color-muted)] truncate">
                    {vo.text || <span className="italic">empty</span>}
                  </span>
                </div>
              )
              return (
                <CollapsibleRow
                  key={voIdx}
                  expanded={isOpen}
                  onToggle={() => setOpenVoIdx(isOpen ? null : voIdx)}
                  summary={summary}
                  density="compact"
                  actions={
                    <button
                      onClick={() => removeVoiceover(voIdx)}
                      className="text-xs px-2 py-1 text-[var(--color-muted)] hover:text-red-400"
                    >
                      Remove
                    </button>
                  }
                >
                  <VoiceoverEditor
                    chapterIndex={chapterIndex}
                    segmentIndex={segmentIndex}
                    voiceoverIndex={voIdx}
                  />
                </CollapsibleRow>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
