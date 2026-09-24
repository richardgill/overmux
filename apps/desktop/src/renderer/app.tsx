import { useEffect, useState, type FormEvent } from "react";

import type { ConnectResult, HostState } from "../shared/contracts.js";

type SetupScreenProps = {
  error?: string;
  onConnect: (url: string, allowInsecure: boolean) => Promise<ConnectResult>;
};

const SetupScreen = ({ error, onConnect }: SetupScreenProps) => {
  const [url, setUrl] = useState("");
  const [pendingHttp, setPendingHttp] = useState<
    { origin: string; url: string } | undefined
  >();
  const [message, setMessage] = useState(error);
  const [connecting, setConnecting] = useState(false);

  const connect = async (input: string, allowInsecure: boolean) => {
    setConnecting(true);
    setMessage(undefined);
    try {
      const result = await onConnect(input, allowInsecure);
      if (result.status === "requires-http-confirmation") {
        setPendingHttp({ origin: result.origin, url: result.url });
      } else if (result.status === "error") {
        setMessage(result.message);
      } else {
        setPendingHttp(undefined);
      }
    } catch (connectError) {
      setMessage(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect to Overmux.",
      );
    } finally {
      setConnecting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connect(url, false);
  };

  return (
    <main className="setup">
      <section className="setup-card" aria-labelledby="setup-title">
        <div className="brand-mark" aria-hidden="true">
          O
        </div>
        <h1 id="setup-title">Connect to Overmux</h1>
        <p className="intro">
          Enter the address of the Overmux instance you want this desktop app to
          host.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="overmux-url">Overmux instance URL</label>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            id="overmux-url"
            onChange={(event) => {
              setUrl(event.target.value);
              setPendingHttp(undefined);
            }}
            placeholder="https://overmux.example.com"
            required
            spellCheck={false}
            type="url"
            value={url}
          />
          <button disabled={connecting} type="submit">
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </form>
        {pendingHttp ? (
          <div className="warning" role="alert">
            <strong>Plain HTTP is not secure</strong>
            <p>
              Traffic and credentials sent to {pendingHttp.origin} can be read
              or changed by others on the network.
            </p>
            <button
              className="danger-button"
              disabled={connecting}
              onClick={() => void connect(pendingHttp.url, true)}
              type="button"
            >
              Connect using HTTP
            </button>
          </div>
        ) : undefined}
        {message ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : undefined}
      </section>
    </main>
  );
};

export const App = () => {
  const [state, setState] = useState<HostState>({});

  useEffect(() => {
    void window.overmuxDesktop.getState().then(setState);
    return window.overmuxDesktop.onState(setState);
  }, []);

  if (state.configuredUrl) {
    return null;
  }
  return (
    <SetupScreen
      error={state.error}
      onConnect={(url, allowInsecure) =>
        window.overmuxDesktop.connect({ allowInsecure, url })
      }
    />
  );
};
