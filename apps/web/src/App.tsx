const serviceBaseUrl =
  import.meta.env.VITE_SERVICE_BASE_URL ?? "http://localhost:4000";

export function App() {
  return (
    <main className="status-page">
      <section className="status-panel" aria-labelledby="status-title">
        <p className="eyebrow">EducationResearcher</p>
        <h1 id="status-title">Foundation scaffold is running</h1>
        <dl>
          <div>
            <dt>Web app</dt>
            <dd>healthy</dd>
          </div>
          <div>
            <dt>Service API</dt>
            <dd>{serviceBaseUrl}/health</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
