import { instanceIdSchema } from "@overmux/shared";
import { z } from "zod";

export const savedConfigSchema = z
  .object({
    url: z.string().optional(),
    // Most recently used address first; each URL belongs to its latest reported ID.
    instanceAddresses: z.array(
      z.object({ url: z.string(), instanceId: instanceIdSchema }).strict(),
    ),
  })
  .strict();

export const connectRequestSchema = z.object({
  allowInsecure: z.boolean(),
  url: z.string().trim().min(1).max(8_192),
});

export type SavedConfig = z.infer<typeof savedConfigSchema>;
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

export type HostState = {
  configuredUrl?: string;
  instanceId?: string;
  error?: string;
};

export type ConnectResult =
  | { status: "connected" }
  | { message: string; status: "error" }
  | { origin: string; status: "requires-http-confirmation"; url: string };

export type DesktopApi = {
  connect: (request: ConnectRequest) => Promise<ConnectResult>;
  getState: () => Promise<HostState>;
  onState: (listener: (state: HostState) => void) => () => void;
};

export const ipcChannels = {
  connect: "overmux-desktop:connect",
  getState: "overmux-desktop:get-state",
  state: "overmux-desktop:state",
} as const;
