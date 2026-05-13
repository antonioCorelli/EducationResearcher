interface ParticipantProps {
  readonly onNavigateToResearcherSignIn: () => void;
}

export function Participant({ onNavigateToResearcherSignIn }: ParticipantProps) {
  return (
    <main className="app-shell participant-shell">
      <section className="workspace-panel" aria-labelledby="participant-title">
        <p className="eyebrow">Participant access</p>
        <h1 id="participant-title">Participant demo route</h1>
        <p className="panel-copy">This route is intentionally public and does not require researcher sign-in.</p>
        <button className="secondary-button" type="button" onClick={onNavigateToResearcherSignIn}>
          Researcher sign-in
        </button>
      </section>
    </main>
  );
}
