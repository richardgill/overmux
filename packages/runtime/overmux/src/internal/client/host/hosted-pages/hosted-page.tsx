import "./hosted-page.css";

import type { ReactNode } from "react";

export const HostedPage = ({ children }: { children: ReactNode }) => (
  <main data-om-hosted-page="">
    <article data-om-hosted-panel="">{children}</article>
  </main>
);
