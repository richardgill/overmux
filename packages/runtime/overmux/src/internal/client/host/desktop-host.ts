type DesktopHost = {
  version: 1;
  platform: string;
  instance?: { report: (identity: { instanceId: string }) => void; version: 1 };
  clipboard?: { writeText: (text: string) => void; version: 1 };
  notifications?: { show: (notification: unknown) => void; version: 1 };
};

declare global {
  interface Window {
    overmuxHost?: DesktopHost;
  }
}

export {};
