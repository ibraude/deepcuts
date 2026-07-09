const KEY = 'deepcuts.voiceBannerDismissed.v1'

export function isVoiceBannerDismissed(): boolean {
  return localStorage.getItem(KEY) === '1'
}

export function dismissVoiceBanner(): void {
  localStorage.setItem(KEY, '1')
}

export function openVoiceSettings(): void {
  window.deepcuts.shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent',
  )
}
