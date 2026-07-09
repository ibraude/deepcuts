import { MetadataEditor } from './forms/MetadataEditor'
import { CoverEditor } from './forms/CoverEditor'
import { HostsEditor } from './forms/HostsEditor'
import { ChaptersEditor } from './forms/ChaptersEditor'

export function ManifestPanel() {
  return (
    <div className="space-y-10">
      <MetadataEditor />
      <CoverEditor />
      <HostsEditor />
      <ChaptersEditor />
    </div>
  )
}
