import { Link, createFileRoute } from "@tanstack/react-router";

const HomePage = () => (
  <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
    <h1 className="text-4xl font-semibold tracking-tight">Overmux</h1>
    <p className="mt-3 text-lg text-fd-muted-foreground">
      Terminal + web building blocks for your agent.
    </p>
    <Link
      className="mt-6 w-fit rounded-md bg-fd-primary px-4 py-2 text-fd-primary-foreground"
      to="/docs/$"
      params={{ _splat: "getting-started/install-and-run-overmux" }}
    >
      Read the docs
    </Link>
  </main>
);

export const Route = createFileRoute("/")({ component: HomePage });
