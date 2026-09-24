import { z } from "zod";

export type LoginInput = { code: string } | { ticket: string };

export type LoginResponse =
  | { status: "authenticated" }
  | { status: "expired" | "invalid" | "rate-limited" | "unknown" };

const authStateSchema = z.object({ authenticated: z.boolean() });
const loginFailureSchema = z.object({
  status: z.enum(["expired", "invalid", "rate-limited"]),
});

const responseJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export const getAuthState = async (signal?: AbortSignal) => {
  const response = await fetch("/api/auth/state", {
    cache: "no-store",
    signal,
  });
  const state = authStateSchema.safeParse(await responseJson(response));
  if (!response.ok || !state.success) {
    throw new Error("Authentication state request failed");
  }
  return state.data;
};

export const login = async (
  input: LoginInput,
  signal?: AbortSignal,
): Promise<LoginResponse> => {
  const response = await fetch("/api/auth/login", {
    body: JSON.stringify(input),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  if (response.ok) {
    return { status: "authenticated" };
  }
  const failure = loginFailureSchema.safeParse(await responseJson(response));
  if (failure.success) {
    return failure.data;
  }
  return { status: "unknown" };
};
