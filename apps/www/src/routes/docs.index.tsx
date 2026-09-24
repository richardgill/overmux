import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/")({
  beforeLoad: () => {
    throw redirect({
      to: "/docs/$",
      params: { _splat: "getting-started/install-and-run-overmux" },
      replace: true,
    });
  },
});
