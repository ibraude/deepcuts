import type { Plugin } from 'vite'

interface Release {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

export function githubReleasePlugin(opts: {
  owner: string
  repo: string
  assetPattern?: RegExp
}): Plugin {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/releases/latest`
  const pattern = opts.assetPattern ?? /\.dmg$/i
  let downloadUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/latest`
  let version = 'latest'

  return {
    name: 'github-release',
    async config() {
      try {
        const resp = await fetch(url, {
          headers: { Accept: 'application/vnd.github+json' },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const release = (await resp.json()) as Release
        version = release.tag_name
        const asset = release.assets.find((a) => pattern.test(a.name))
        if (asset) downloadUrl = asset.browser_download_url
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[github-release] Failed to fetch latest release: ${(err as Error).message}. Falling back to releases page.`,
        )
      }
      return {
        define: {
          'import.meta.env.VITE_DOWNLOAD_URL': JSON.stringify(downloadUrl),
          'import.meta.env.VITE_DOWNLOAD_VERSION': JSON.stringify(version),
        },
      }
    },
  }
}
