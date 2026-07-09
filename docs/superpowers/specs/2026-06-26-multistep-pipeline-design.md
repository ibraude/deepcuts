# Spec C — Multi-step Pipeline with Editable Artifacts

**Date:** 2026-06-26
**Scope:** Replace single-shot generation with a multi-step pipeline that produces editable intermediate artifacts (Research → Outline → Script & Songs). Each artifact saves to disk; user can edit any and re-run downstream steps.

## Goal

When generating a draft:
1. **Research** — LLM with web search produces a markdown research document about the subject (facts, dates, session players, anecdotes).
2. **Outline** — LLM reads the research and produces a structured chapter outline with proposed hosts, song wishes, narration beats.
3. **Script + Songs** — LLM writes full narration + voiceovers from outline+research; songs resolve to Spotify URIs.

Each step is its own LLM call. Artifacts persist on disk. The Editor gets **Research** and **Outline** tabs alongside the existing Manifest editor. User can edit research/outline and re-run downstream steps from there.

## Non-goals

- Streaming UI per step (artifacts appear when each step completes)
- Per-step model selection (one configured provider runs all steps)
- Pre-rendering ElevenLabs narration as part of the pipeline (Spec E territory; live synthesis at playback)

## Storage additions per draft

```
<userData>/drafts/<id>/
  manifest.json     # existing — the final draft
  cover.png         # existing
  research.md       # NEW — markdown research doc
  outline.json      # NEW — structured outline
```

`outline.json` shape:
```ts
interface DraftOutline {
  proposedHosts: Array<{ id; name; persona; voiceRefHint }>
  chapters: Array<{
    title: string
    beats: Array<
      | { type: 'narration'; hostId: string; intent: string }   // one-sentence summary of what the narration should say
      | { type: 'song'; trackRequest: { title; artist; searchHint? }; why: string; voiceoverBeats: Array<{ hostId; intent; atSeconds }> }
    >
  }>
}
```

## Main process modules

`src/main/generation/` gets new step functions:

```ts
runResearchStep(subject, hints, signal): Promise<{ markdown: string }>
runOutlineStep(subject, researchMarkdown, signal): Promise<DraftOutline>
runScriptStep(subject, researchMarkdown, outline, signal): Promise<GeneratedManifest>
```

Each is a thin wrapper over the existing provider's `generateObject` (or `generateText` for research). System prompts are step-specific.

`runResearchStep` enables Gemini's Google Search grounding via `providerOptions`. Wired through the existing `ScriptProvider` interface — adding a new method `provider.research(...)` that internally enables search.

## Updated pipeline orchestrator

`runGenerationPipeline(input, deps)` is renamed and split:

```ts
// New: full pipeline (existing single-shot signature kept for backwards compat)
runFullPipeline(input, deps)              # research → outline → script → resolve → save manifest

// New: per-step runners (used by editor "re-run" buttons)
runResearchOnly(draftId, deps)
runOutlineOnly(draftId, deps)
runScriptOnly(draftId, deps)
runResolveOnly(draftId, deps)              # only resolves songs, doesn't re-write script
```

After each step, the orchestrator writes the artifact to the draft directory.

`runFullPipeline` is what the Generate tab in NewDraftModal calls. It emits progress events with `step: 'research' | 'outline' | 'script' | 'resolving' | 'finalizing'`.

## IPC additions

```ts
window.deepcuts.drafts.loadResearch(draftId): Promise<string>          # markdown content, or empty string if missing
window.deepcuts.drafts.saveResearch(draftId, markdown): Promise<void>
window.deepcuts.drafts.loadOutline(draftId): Promise<unknown>          # JSON
window.deepcuts.drafts.saveOutline(draftId, outline): Promise<void>

window.deepcuts.generation.runStep(draftId, step): Promise<{ warnings? }>
  // step: 'research' | 'outline' | 'script' | 'resolve'
```

Progress events extended with the new step names.

## DraftEditor UI

Tabs at the top of the editor: **Manifest · Research · Outline**

- **Manifest** — current form-based editor, unchanged.
- **Research** — large textarea with the markdown content + "Re-generate research" button (with confirm if non-empty). Status pill: "Empty" / "Generated" / "Edited".
- **Outline** — readable structured display (chapters list, beats indented) + "Re-generate outline" button. Status pill same pattern. Outline editing is text-based for v1 (raw JSON in a textarea); a richer outline editor can come in a later spec.

Below the tab content for Research and Outline:
- "Re-run downstream" button — kicks off the next step(s) using the current artifact, plus a button to re-run all downstream steps.

Tab switching preserves dirty state per artifact.

## NewDraftModal updates

Generate tab unchanged from a UX standpoint but internally calls `runFullPipeline` instead of `runGenerationPipeline`. Progress messages mention each step by name.

## Tests

- `prompts.test.ts` — researchPrompt / outlinePrompt / scriptPrompt produce expected text
- `pipeline.test.ts` — full pipeline orchestration with mocked provider; verifies artifacts saved at the right paths
- Existing tests stay green

## Definition of done

1. Generating from a subject runs all three LLM steps and saves Research, Outline, and the final manifest
2. DraftEditor has Manifest / Research / Outline tabs
3. Each non-Manifest tab is editable, has a Save button (per-tab dirty state), and a Re-generate button
4. Editing Research and clicking "Re-run from Research" regenerates Outline and Script
5. Editing Outline and clicking "Re-run from Outline" regenerates Script only
6. `npm run typecheck`, `npm test`, `npm run build` all pass
