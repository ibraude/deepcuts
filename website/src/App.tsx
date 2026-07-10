import { Header } from './components/Header'

export default function App() {
  return (
    <main className="min-h-screen">
      <Header />
      <div id="top" />
      <div className="pt-[120px] p-12 tracking-caps text-xs" style={{ color: 'var(--muted)' }}>
        DeepCuts — scaffolding
      </div>
    </main>
  )
}
