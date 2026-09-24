export type DocumentationNavigationGroup = {
  pages: readonly string[];
  title: string;
};

export type DocumentationNavigationItem = string | DocumentationNavigationGroup;

export type DocumentationMetadata = {
  description?: string;
  pages?: readonly DocumentationNavigationItem[];
  title: string;
};

export type DocumentationWebsite = DocumentationMetadata & {
  folders?: Readonly<Record<string, DocumentationMetadata>>;
  path: string;
};

export type DocumentationPagePath = `${string}.md` | `${string}.mdx`;

export type DocumentationPage = {
  navigation?: boolean;
  route: string;
  source: DocumentationPagePath;
};

export type DocumentationGroup = {
  description?: string;
  navigation?: readonly string[];
  groups?: readonly DocumentationGroup[];
  page?: DocumentationPage;
  pages?: readonly DocumentationPage[];
  route: string;
  title: string;
};

export type DocumentationSourceWebsite = Omit<
  DocumentationWebsite,
  "folders" | "pages"
> & {
  groups?: readonly DocumentationGroup[];
  navigation?: readonly string[];
  page?: DocumentationPage;
  pages?: readonly DocumentationPage[];
};

export type DocumentationSource = {
  directory: string;
  website: DocumentationSourceWebsite;
};

export const documentationRoots: readonly DocumentationWebsite[] = [
  {
    path: "packages",
    title: "Packages",
    pages: [
      "tmux",
      "xterm",
      "xterm-fork",
      { title: "AI agents", pages: ["pi"] },
      "jsonl-store",
      "git",
      "zellij",
    ],
  },
];

// Keep source folders and filenames aligned with routes, allowing numeric ordering prefixes and 000-index.md for group landing pages.
export const documentationSources: readonly DocumentationSource[] = [
  {
    directory: "packages/runtime/overmux/docs",
    website: {
      path: "",
      title: "Documentation",
      page: { source: "000-index.md", route: "" },
      navigation: ["introduction", "getting-started", "reference", "packages"],
      pages: [
        {
          source: "500-hosted-pages.md",
          route: "hosted-pages",
          navigation: false,
        },
      ],
      groups: [
        {
          route: "introduction",
          title: "Introduction",
          pages: [
            {
              source: "100-introduction/200-how-overmux-works.md",
              route: "introduction/how-overmux-works",
            },
            {
              source: "100-introduction/300-why-i-built-overmux.md",
              route: "introduction/why-i-built-overmux",
            },
          ],
        },
        {
          route: "getting-started",
          title: "Getting Started",
          navigation: [
            "install-and-run-overmux",
            "install-overmux-desktop",
            "install-overmux-pwa",
            "secure-with-https",
            "set-up-overmux-with-packages",
          ],
          pages: [
            {
              source: "200-getting-started/100-install-and-run-overmux.md",
              route: "getting-started/install-and-run-overmux",
            },
            {
              source: "200-getting-started/200-install-overmux-desktop.md",
              route: "getting-started/install-overmux-desktop",
            },
            {
              source: "200-getting-started/300-install-overmux-pwa.mdx",
              route: "getting-started/install-overmux-pwa",
            },
            {
              source: "200-getting-started/500-set-up-overmux-with-packages.md",
              route: "getting-started/set-up-overmux-with-packages",
            },
          ],
          groups: [
            {
              route: "getting-started/secure-with-https",
              title: "Secure with HTTPS",
              pages: [
                {
                  source:
                    "200-getting-started/400-secure-with-https/100-choose-an-https-setup.md",
                  route:
                    "getting-started/secure-with-https/choose-an-https-setup",
                },
                {
                  source:
                    "200-getting-started/400-secure-with-https/200-tailscale-serve.md",
                  route: "getting-started/secure-with-https/tailscale-serve",
                },
                {
                  source:
                    "200-getting-started/400-secure-with-https/300-cloudflare-tunnel.md",
                  route: "getting-started/secure-with-https/cloudflare-tunnel",
                },
                {
                  source:
                    "200-getting-started/400-secure-with-https/400-self-hosted-reverse-proxy.md",
                  route:
                    "getting-started/secure-with-https/self-hosted-reverse-proxy",
                },
              ],
            },
          ],
        },
        {
          route: "reference",
          title: "Reference",
          navigation: [
            "project-structure",
            "configuration",
            "authentication-and-security",
            "server",
            "client",
            "cli",
            "storage-locations",
          ],
          pages: [
            {
              source: "400-reference/300-storage-locations.md",
              route: "reference/storage-locations",
            },
            {
              source: "400-reference/100-project-structure.md",
              route: "reference/project-structure",
            },
            {
              source: "400-reference/200-configuration.md",
              route: "reference/configuration",
            },
            {
              source: "400-reference/400-authentication-and-security.md",
              route: "reference/authentication-and-security",
            },
          ],
          groups: [
            {
              route: "reference/server",
              title: "Server",
              page: {
                source: "400-reference/500-server/000-index.md",
                route: "reference/server",
              },
              pages: [
                {
                  source: "400-reference/500-server/100-resources.md",
                  route: "reference/server/resources",
                },
                {
                  source: "400-reference/500-server/200-operations.md",
                  route: "reference/server/operations",
                },
                {
                  source: "400-reference/500-server/300-streams.md",
                  route: "reference/server/streams",
                },
                {
                  source: "400-reference/500-server/400-notifications.md",
                  route: "reference/server/notifications",
                },
                {
                  source: "400-reference/500-server/500-api.md",
                  route: "reference/server/api",
                },
              ],
            },
            {
              route: "reference/client",
              title: "Client",
              page: {
                source: "400-reference/600-client/000-index.md",
                route: "reference/client",
              },
              pages: [
                {
                  source: "400-reference/600-client/005-setting-up-your-ui.md",
                  route: "reference/client/setting-up-your-ui",
                },
                {
                  source: "400-reference/600-client/010-commands.md",
                  route: "reference/client/commands",
                },
                {
                  source: "400-reference/600-client/020-shortcuts.md",
                  route: "reference/client/shortcuts",
                },
                {
                  source: "400-reference/600-client/200-theming.md",
                  route: "reference/client/theming",
                },
                {
                  source: "400-reference/600-client/007-deep-links.md",
                  route: "reference/client/deep-links",
                },
                {
                  source: "400-reference/600-client/100-api.md",
                  route: "reference/client/api",
                },
                {
                  source:
                    "400-reference/600-client/300-tech-stack-recommendations.md",
                  route: "reference/client/tech-stack-recommendations",
                },
              ],
            },
            {
              route: "reference/cli",
              title: "CLI",
              description: "Overmux commands",
              pages: [
                {
                  source: "400-reference/700-cli/200-auth.md",
                  route: "reference/cli/auth",
                },
                {
                  source: "400-reference/700-cli/300-call.md",
                  route: "reference/cli/call",
                },
                {
                  source: "400-reference/700-cli/700-desktop.md",
                  route: "reference/cli/desktop",
                },
                {
                  source: "400-reference/700-cli/600-docs.md",
                  route: "reference/cli/docs",
                },
                {
                  source: "400-reference/700-cli/050-init.md",
                  route: "reference/cli/init",
                },
                {
                  source: "400-reference/700-cli/350-instance.md",
                  route: "reference/cli/instance",
                },
                {
                  source: "400-reference/700-cli/100-serve.md",
                  route: "reference/cli/serve",
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    directory: "packages/runtime/lib/docs",
    website: { path: "packages/lib", title: "Runtime library" },
  },
  {
    directory: "packages/ecosystem/git/docs",
    website: {
      path: "packages/git",
      title: "Git (experimental)",
    },
  },
  {
    directory: "packages/ecosystem/jsonl-store/docs",
    website: { path: "packages/jsonl-store", title: "JSONL store" },
  },
  {
    directory: "packages/ecosystem/keybindings/docs",
    website: { path: "packages/keybindings", title: "Keybindings" },
  },
  {
    directory: "packages/ecosystem/pi/docs",
    website: { path: "packages/pi", title: "Pi (experimental)" },
  },
  {
    directory: "packages/ecosystem/pty/docs",
    website: { path: "packages/pty", title: "PTY" },
  },
  {
    directory: "packages/ecosystem/tmux/docs",
    website: { path: "packages/tmux", title: "Tmux" },
  },
  {
    directory: "packages/ecosystem/zellij/docs",
    website: { path: "packages/zellij", title: "Zellij (experimental)" },
  },
  {
    directory: "packages/ecosystem/terminal-stream/docs",
    website: { path: "packages/terminal-stream", title: "Terminal stream" },
  },
  {
    directory: "packages/ecosystem/ui/docs",
    website: { path: "packages/ui", title: "UI" },
  },
  {
    directory: "packages/ecosystem/xterm-fork/docs",
    website: { path: "packages/xterm-fork", title: "xterm fork" },
  },
  {
    directory: "packages/ecosystem/xterm/docs",
    website: { path: "packages/xterm", title: "xterm (terminal)" },
  },
];
