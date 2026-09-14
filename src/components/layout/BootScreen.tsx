export function BootScreen({ label = "Carregando" }: { label?: string }) {
  return (
    <div className="grid-dots flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="pixelated block h-3 w-3 animate-pulse-soft bg-primary"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {label}
          <span className="animate-blink">_</span>
        </p>
      </div>
    </div>
  );
}
