import "./recovery-screen.css";

export const RecoveryScreen = ({ error }: { error?: string }) => (
  <main data-om-recovery="">
    <section data-om-recovery-panel="">
      <h1 data-om-recovery-title="">Overmux recovery</h1>
      {error ? <pre data-om-recovery-error="">{error}</pre> : null}
      <button
        data-om-recovery-reload=""
        onClick={() => location.reload()}
        type="button"
      >
        Reload
      </button>
    </section>
  </main>
);
