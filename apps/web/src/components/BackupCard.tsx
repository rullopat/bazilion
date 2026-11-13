/** The same archive as `bazilion backup create`, saved by the browser straight from the daemon. */
export function BackupCard() {
  return (
    <section
      aria-label="Backup"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold">Backup</h2>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm sm:px-5">
        <p className="m-0 max-w-prose text-muted-foreground">
          A tar.gz of the Bazilion home. It is not encrypted and holds every stored credential; for
          an encrypted copy run <code>bazilion backup create --recipient &lt;age1…&gt;</code>.
          Restore with <code>bazilion backup restore</code> while the daemon is stopped.
        </p>
        <a href="/api/backup" download className="btn-primary no-underline">
          Download backup
        </a>
      </div>
    </section>
  )
}
