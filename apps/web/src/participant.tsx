import { useEffect, useState } from "react";

const serviceBaseUrl = import.meta.env.VITE_SERVICE_BASE_URL ?? "http://localhost:4000";

interface ParticipantProps {
  readonly onNavigateToResearcherSignIn: () => void;
}

type ParticipantAccessState =
  | { readonly status: "demo" }
  | { readonly status: "checking" }
  | {
      readonly status: "ready";
      readonly run: {
        readonly id: string;
        readonly status: string;
        readonly freshnessDeadlineAt: string;
      };
    }
  | { readonly status: "blocked"; readonly message: string };

export function Participant({ onNavigateToResearcherSignIn }: ParticipantProps) {
  const [accessState, setAccessState] = useState<ParticipantAccessState>(() => {
    const accessToken = getParticipantAccessTokenFromPath();

    return accessToken ? { status: "checking" } : { status: "demo" };
  });

  useEffect(() => {
    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken) {
      return;
    }

    let cancelled = false;

    async function validateAccess() {
      try {
        const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}`);
        const payload = (await response.json()) as {
          run?: { id: string; status: string; freshnessDeadlineAt: string };
          message?: string;
        };

        if (!response.ok || !payload.run) {
          throw new Error(payload.message ?? "This participant link is not available.");
        }

        if (!cancelled) {
          setAccessState({ status: "ready", run: payload.run });
        }
      } catch (error) {
        if (!cancelled) {
          setAccessState({
            status: "blocked",
            message: error instanceof Error ? error.message : "This participant link is not available."
          });
        }
      }
    }

    void validateAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  if (accessState.status === "checking") {
    return (
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">Checking link</h1>
          <p className="panel-copy">Please wait while we confirm this run is available.</p>
        </section>
      </main>
    );
  }

  if (accessState.status === "blocked") {
    return (
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">This link is not available</h1>
          <p className="panel-copy">{accessState.message}</p>
        </section>
      </main>
    );
  }

  if (accessState.status === "ready") {
    return (
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">Run ready</h1>
          <p className="panel-copy">Your study run is ready to continue.</p>
        </section>
      </main>
    );
  }

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

function getParticipantAccessTokenFromPath() {
  const match = /^\/participant\/runs\/([^/]+)$/.exec(window.location.pathname);

  return match ? decodeURIComponent(match[1]!) : undefined;
}
