export function Equalizer({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className="inline-flex items-end gap-[3px] h-3"
      style={{ color: 'currentColor' }}
    >
      {[0, 0.2, 0.4, 0.6].map((delay, i) => (
        <span
          key={i}
          style={{
            display: 'block',
            width: 2,
            height: '100%',
            background: 'currentColor',
            transformOrigin: 'bottom',
            animation: active
              ? `eq 1.1s ease-in-out ${delay}s infinite alternate`
              : 'none',
            transform: active ? undefined : 'scaleY(0.3)',
          }}
        />
      ))}
      <style>{`
        @keyframes eq {
          0%   { transform: scaleY(0.3); }
          50%  { transform: scaleY(1); }
          100% { transform: scaleY(0.5); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes eq { 0%, 100% { transform: scaleY(0.6); } }
        }
      `}</style>
    </div>
  )
}
