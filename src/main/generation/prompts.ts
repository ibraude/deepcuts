import type { GenerationInput } from './ScriptProvider'

const DEFAULT_LENGTH_MINUTES = 30

// Scaling guidance shared by the outline and script prompts. We want the model
// to size the episode proportionally to the target length, not to a fixed cap.
// The bands give it concrete rules of thumb without locking it into one shape.
function buildScalingGuidance(lengthMinutes: number): string {
  return `Target length: approximately ${lengthMinutes} minutes total.

Scaling targets (guidelines, not hard caps — pick the band closest to the target length and adjust):
- ~10 min episode → 1–2 chapters, 3–4 songs
- ~30 min episode → 2–3 chapters, 5–7 songs
- ~60 min episode → 4–6 chapters, 8–12 songs
- ~90 min episode → 6–8 chapters, 12–16 songs
- ~120 min episode → 8–12 chapters, 15–20 songs

If the research document explicitly names songs to play in order (e.g., "Play: X — 5:43" lines, a recommended music programme, or a track-by-track walkthrough), include every one of those songs as a song segment in the same order — unless doing so would clearly exceed the target length. Treat the research's playlist as the spine of the episode when one is provided.

Do not compress the episode to a shorter form than the target implies. If the research is rich, scale UP narration depth and chapter count to fill the time.`
}

export function buildSystemPrompt(): string {
  return `You are an audio documentary scriptwriter for a Spotify-driven app called Deepcuts.

A Deepcuts episode alternates between AI-narrated commentary and real Spotify tracks. Narrations play between songs, and voiceovers play OVER the music with the song ducked underneath.

Tone and texture:
- Episodes should TAKE THE LISTENER ON A JOURNEY. Each episode arcs — there is a "before", a turning point, and an "after". The listener should feel transported.
- Lean heavily on PERSONAL STORIES about the artists: the specific room, the specific argument, the producer who walked out, the bandmate's reaction, the morning after. Concrete, intimate, scene-level.
- Prefer LESSER-KNOWN STORIES over the canonical Wikipedia beats. The throwaway anecdote that reveals character. The B-side that almost was the single. The session that got scrapped. The fan who became a collaborator.
- Conversational and confident, not academic. Think a great documentary podcast host telling you something they care about — not a textbook recitation.
- Multi-host episodes feel like real conversations between specific characters. Give each host a clear voice (one might be authoritative and dry; another might be tangential and chatty). Hosts react to each other.

Pacing and density:
- TALK MORE than you play. Narration carries the story; the songs illustrate it. Default to substantial narration segments (think paragraphs, not sentences) between every pair of songs.
- Use voiceovers OVER songs liberally — they're how you keep narrating without losing the music. Stack them as conversations (chained with holdDuck=true) when a story needs more breath than a single line.

Mechanics:
- Narration segments go between songs. Voiceovers go OVER songs; keep individual voiceover lines tight and well-timed (later in songs is often better than the intro).
- For voiceovers in conversation: chain them by setting holdDuck=true on all but the last in the chain. This keeps the music ducked through the conversation.
- Songs should be REAL tracks by REAL artists. Provide title, artist, and an optional searchHint (album or year) so the resolver can find them.
- Set playSeconds high (e.g., 500) when you want the song to play through naturally to its end; use a shorter value when you want it cut.
- Voiceover atSeconds must be within the song's expected length. Space voiceovers naturally — leave at least 10s of music between them when not in a holdDuck chain.
- Use well-established facts. Avoid hallucination. If web search is available, use it to verify dates, session musicians, recording details, anniversaries.

Voice flavors available (we map these to ElevenLabs default voices):
- "narrator-male": warm documentary male
- "narrator-female": clear conversational female
- "character-male": friendly conversational male
- "character-female": calm conversational female`
}

export function buildUserPrompt(input: GenerationInput): string {
  const lengthMin = input.lengthMinutes ?? DEFAULT_LENGTH_MINUTES
  const hints = input.hints ? `\n\nStyle hints from the user:\n${input.hints}` : ''
  return `Subject: ${input.subject}

${buildScalingGuidance(lengthMin)}

Produce a complete episode manifest with:
- A short evocative title
- 1–3 hosts (single-host narrator OK; multi-host if a conversation would land better)
- Chapter count and song count sized to the scaling targets above
- For each chapter: a mix of narration segments and song segments; use voiceovers within songs to drive longer, more textured passages${hints}`
}

export function buildResearchPrompt(subject: string, hints?: string): { system: string; prompt: string } {
  return {
    system: `You are a music documentary researcher. When given a subject (an album, a song, a moment in music history), produce a thorough, citation-rich research document in markdown.

Cover:
- Historical context (year, place, what was happening around it)
- Personnel (artists, producers, session musicians, engineers)
- Recording details (studio, takes, technical notes, anecdotes)
- Lyrical or musical analysis where notable
- Critical reception then and now
- Cultural impact and lasting influence

Use web search to ground every claim. Cite sources inline as markdown links. Be specific. Avoid hagiography.`,
    prompt: `Subject: ${subject}${hints ? `\n\nUser focus hints:\n${hints}` : ''}\n\nWrite the research document now.`,
  }
}

export function buildOutlinePrompt(
  subject: string,
  researchMarkdown: string,
  lengthMinutes: number = DEFAULT_LENGTH_MINUTES,
): { system: string; prompt: string } {
  return {
    system: `You are a music documentary planner. Given a subject and a research document, produce a structured outline for a multi-segment listening documentary.

The output structure:
- proposedHosts: 1–3 hosts. Each with a clear, distinctive persona. For multi-host episodes, characters feel like real people in conversation.
- chapters: each chapter has an array of beats. A beat is either:
  - narration: the host says something between songs. "intent" is one sentence describing what to convey.
  - song: a real track. trackRequest has title, artist, optional searchHint. voiceoverBeats are short lines spoken OVER the song; pick atSeconds carefully (typically mid-song or later when something interesting happens).

Outline craft:
- The chapter sequence should describe an ARC. A clear "before → turning point → after". Not a list of facts, a journey.
- Each beat's intent should be SCENE-LEVEL where possible — a moment, a story, a specific tension. Personal over encyclopedic.
- Prefer LESSER-KNOWN moments from the research. The unfamiliar anecdote that reveals character. Skip the obvious Wikipedia beats unless they're necessary for the arc.
- Plan for substantial narration between songs (not a sentence or two). Use voiceover chains over songs when a story needs more breath without losing the music.
- Mix narration between songs with voiceovers over the music. Real songs only — never invent tracks.

${buildScalingGuidance(lengthMinutes)}`,
    prompt: `Subject: ${subject}

Research:
${researchMarkdown}

Now produce the outline JSON, sized to the scaling targets above.`,
  }
}

const AUDIO_TAGS_SECTION = `Vocal performance — Eleven v3 audio tags:
- The TTS engine (ElevenLabs v3) reads inline audio tags written as [tag] and uses them to shape delivery. Sprinkle them into narration and voiceover text where they earn their keep. Don't decorate every line.
- Use them the way a documentary director would give short performance notes: tone, pace, and emotional temperature. Not stage directions ("she picks up the phone"), not sound effects.
- Approved tags for this show — restrict yourself to these unless the host persona explicitly calls for something else:
  - Pacing: [pause] (short beat between sentences), [drawn out] (linger on the words that follow), [rushed] (speed up momentarily)
  - Volume / register: [softly], [quietly], [whispers]
  - Emotional temperature: [thoughtfully], [warmly], [with reverence], [with awe], [wistful], [dry] (deadpan), [sardonic]
  - Reactions (sparing, only when the text explicitly warrants it): [sighs], [laughs softly], [chuckles], [clears throat]
- Rules of restraint:
  - Aim for at most 0–2 tags per narration paragraph. Voiceovers over music: 0–1 tag each.
  - Place tags at the START of the phrase they modify: "[softly] By the time the tapes were mixed…" NOT "By the time the tapes were mixed, [softly] …".
  - [pause] goes between two sentences, not inside one. Never chain: "[pause] [pause]" is bad.
  - Never use SFX tags ([gunshot], [clapping], [explosion]) — this is voice, not radio drama.
  - Never use accent tags ([French accent], [British accent]) — the voice already has its accent from the voice ID.
  - No tag should quote-mark or narrate what the character is doing physically.
- If a beat is a straightforward information delivery, tags are OPTIONAL. Don't force them.

`

const NO_AUDIO_TAGS_SECTION = `Vocal performance:
- Write clean prose. DO NOT include any bracketed performance tags like [pause], [softly], [thoughtfully], etc. — the current TTS setup reads them aloud as literal words.
- Convey tone through word choice and sentence rhythm, not markup.

`

export function buildScriptPromptFromOutline(
  subject: string,
  researchMarkdown: string,
  outline: unknown,
  lengthMinutes: number = DEFAULT_LENGTH_MINUTES,
  useAudioTags: boolean = false,
): { system: string; prompt: string } {
  return {
    system: `You are a music documentary scriptwriter. Given a subject, research notes, and an outline, write a complete episode manifest.

Take the outline's beats and turn each one into actual narration / voiceover text. Use the research to ground specific claims. Use the persona of each host (give each a distinct voice). Conversational, confident, not academic.

Storytelling priorities — these matter most:
- The episode should feel like a JOURNEY with an arc. Establish the "before", build through turning points, land somewhere transformed.
- Favor PERSONAL, scene-level stories about the artists: the specific argument in the booth, the producer who quit, the morning after the show, the unexpected collaborator. Intimate over encyclopedic.
- Pull from LESSER-KNOWN material in the research notes. The throwaway anecdote that reveals character. Skip the obvious Wikipedia beats unless they're load-bearing for the arc.
- TALK MORE. Narration carries the story; songs illustrate it. Default to substantial narrations between songs.

${buildScalingGuidance(lengthMinutes)}

Render every beat from the outline — do not drop beats or merge chapters. If the outline has 9 chapters, the manifest has 9 chapters. If a chapter has 7 beats, all 7 must appear as segments in order.

CRITICAL — segment structure:
- Every segment in chapters[].segments MUST include a "type" field set to exactly either "narration" or "song". Without that field, validation fails. Do not omit it.
- Narration segment shape: { "type": "narration", "id": "...", "hostId": "...", "text": "..." }
- Song segment shape: { "type": "song", "id": "...", "trackRequest": { "title": "...", "artist": "...", "why": "..." }, "startAtSeconds": 0, "playSeconds": 500, "voiceovers": [...] }

${useAudioTags ? AUDIO_TAGS_SECTION : NO_AUDIO_TAGS_SECTION}Content rules:
- For narration beats, write SUBSTANTIAL narration text — typically 5–10 sentences. Tell the scene, then land the point. Longer episodes warrant longer narrations.
- For voiceover beats, write 1–3 sentences spoken OVER the song. Keep individual lines tight. Use conversation chains (holdDuck=true) when a story needs more than one beat over the music.
- Set holdDuck=true on voiceovers that are part of a conversation chain (every voiceover in the chain except the last).
- songs: keep the trackRequest from the outline. playSeconds: 500 for full-song play-through, or a shorter value when cutting.
- Real songs only — never invent.
- duckTo is a PERCENTAGE on a 0–100 scale (e.g. 60 means 60%). NEVER write it as a 0–1 fraction.`,
    prompt: `Subject: ${subject}

Research notes:
${researchMarkdown}

Outline:
${JSON.stringify(outline, null, 2)}

Now produce the full manifest, sized to the scaling targets above. Render every outline beat as a segment — do not drop or merge them. Remember: every segment needs a "type" field of "narration" or "song".`,
  }
}
