import { useEditorStore } from './editorStore'
import { DraftList } from './DraftList'
import { DraftEditor } from './DraftEditor'

export function EditorView() {
  const currentDraftId = useEditorStore((s) => s.currentDraftId)
  return currentDraftId ? <DraftEditor /> : <DraftList />
}
