export const IpcChannels = {
  SpotifyIsAvailable: 'spotify:isAvailable',
  SpotifyEnsureReady: 'spotify:ensureReady',
  SpotifyPlay: 'spotify:play',
  SpotifyPause: 'spotify:pause',
  SpotifyGetPosition: 'spotify:getPosition',
  SpotifyGetState: 'spotify:getState',
  SpotifyGetCurrentTrack: 'spotify:getCurrentTrack',
  SpotifyGetDuration: 'spotify:getDuration',
  SpotifyGetVolume: 'spotify:getVolume',
  SpotifySetVolume: 'spotify:setVolume',

  TtsElevenLabs: 'tts:elevenlabs',

  KeychainGet: 'keychain:get',
  KeychainSet: 'keychain:set',
  KeychainDelete: 'keychain:delete',

  CatalogLoadLocal: 'catalog:loadLocal',
  ManifestLoad: 'manifest:load',
  CoverUrl: 'assets:coverUrl',
  OpenExternal: 'shell:openExternal',

  DraftsList: 'drafts:list',
  DraftsLoad: 'drafts:load',
  DraftsSave: 'drafts:save',
  DraftsCreate: 'drafts:create',
  DraftsDelete: 'drafts:delete',
  DraftsDuplicate: 'drafts:duplicateFromEpisode',
  DraftsCoverUrl: 'drafts:coverUrl',
  DraftsSetCover: 'drafts:setCover',

  GenerationStart: 'generation:start',
  GenerationCancel: 'generation:cancel',
  GenerationProgress: 'generation:progress',
  GenerationRunStep: 'generation:runStep',

  DraftsLoadResearch: 'drafts:loadResearch',
  DraftsSaveResearch: 'drafts:saveResearch',
  DraftsLoadOutline: 'drafts:loadOutline',
  DraftsSaveOutline: 'drafts:saveOutline',

  ImageGenerateAndSetCover: 'image:generateAndSetCover',
  PrerenderStart: 'prerender:start',
  PrerenderCancel: 'prerender:cancel',

  LibraryList: 'library:list',
  LibraryPublish: 'library:publish',
  LibraryUnpublish: 'library:unpublish',
  LibraryLoadManifest: 'library:loadManifest',
  LibraryCoverUrl: 'library:coverUrl',
  LibraryIsPublished: 'library:isPublished',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export interface SpotifyState {
  state: 'playing' | 'paused' | 'stopped'
}

export interface SpotifyCurrentTrack {
  id: string
  uri: string
  name?: string
  artist?: string
}
