import { generateAiContextDocumentation } from "../../../scripts/generate-ai-context-docs.ts";
import { metaSchema } from "fumadocs-core/source/schema";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  documentationRoots,
  documentationSources,
  type DocumentationGroup,
  type DocumentationMetadata,
  type DocumentationNavigationGroup,
  type DocumentationPage,
  type DocumentationSource,
  type DocumentationWebsite,
} from "../../../docs.config.ts";

type StageDocumentationOptions = {
  assetsDestination: string;
  destination: string;
  mode?: "replace" | "sync";
  roots: readonly DocumentationWebsite[];
  sources: readonly DocumentationSource[];
};
type StagingPlan = {
  content?: string;
  destinationPath: string;
  sourcePath: string;
};
type StagingPlans = { assets: StagingPlan[]; documents: StagingPlan[] };
type MetadataEntry = { path: string; website: DocumentationMetadata };
type RoutedPage = DocumentationPage & { index: boolean };

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const generatedDirectory = fileURLToPath(
  new URL("../generated/package-docs", import.meta.url),
);
const generatedAssetsDirectory = fileURLToPath(
  new URL("../public/docs", import.meta.url),
);
const relativeMarkdownLink =
  /(\]\()((?![a-z][a-z\d+.-]*:|\/|#)[^\s)#?]+)\.(mdx?)((?:#[^\s)]*)?\))/gi;

const isDocument = (path: string) => [".md", ".mdx"].includes(extname(path));

const walkFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walkFiles(path) : [path];
      }),
  );
  return files.flat();
};

const groupRoutedPages = (
  group: DocumentationGroup,
  parentRoute?: string,
): RoutedPage[] => {
  if (parentRoute && !group.route.startsWith(`${parentRoute}/`)) {
    throw new Error(`Group route ${group.route} must be under ${parentRoute}`);
  }
  if (group.page && group.page.route !== group.route) {
    throw new Error(`Group page route must equal ${group.route}`);
  }
  const pages = group.pages ?? [];
  pages.forEach((page) => {
    if (!page.route.startsWith(`${group.route}/`)) {
      throw new Error(`Page route ${page.route} must be under ${group.route}`);
    }
  });
  return [
    ...(group.page ? [{ ...group.page, index: true }] : []),
    ...pages.map((page) => ({ ...page, index: false })),
    ...(group.groups ?? []).flatMap((child) =>
      groupRoutedPages(child, group.route),
    ),
  ];
};

const routedPages = (source: DocumentationSource): RoutedPage[] => [
  ...(source.website.page ? [{ ...source.website.page, index: true }] : []),
  ...(source.website.pages ?? []).map((page) => ({ ...page, index: false })),
  ...(source.website.groups ?? []).flatMap((group) => groupRoutedPages(group)),
];

const validateRoutedPages = (pages: readonly RoutedPage[]) => {
  const sources = pages.map(({ source }) => source);
  const routes = pages.map(({ route }) => route);
  if (new Set(sources).size !== sources.length) {
    throw new Error("Documentation source paths must be unique");
  }
  if (new Set(routes).size !== routes.length) {
    throw new Error("Documentation routes must be unique");
  }
  pages.forEach(({ route }) => {
    if (route.startsWith("/") || route.split("/").includes("..")) {
      throw new Error(`Documentation route must be relative: ${route}`);
    }
  });
};

const rewriteRoutedLinks = ({
  content,
  page,
  pages,
  websitePath,
}: {
  content: string;
  page: RoutedPage;
  pages: readonly RoutedPage[];
  websitePath: string;
}) => {
  const routesBySource = new Map<string, string>(
    pages.map((item) => [item.source, item.route]),
  );
  return content.replaceAll(
    relativeMarkdownLink,
    (match, opening, target, extension, closing) => {
      const source = posix.normalize(
        posix.join(posix.dirname(page.source), `${target}.${extension}`),
      );
      const route = routesBySource.get(source);
      if (route === undefined) {
        return match;
      }
      const destination = ["docs", websitePath, route]
        .filter(Boolean)
        .join("/");
      return `${opening}/${destination}${closing}`;
    },
  );
};

const routedDocumentPlans = async ({
  destination,
  docsDirectory,
  pages,
  source,
}: {
  destination: string;
  docsDirectory: string;
  pages: readonly RoutedPage[];
  source: DocumentationSource;
}) => {
  validateRoutedPages(pages);
  return await Promise.all(
    pages.map(async (page) => {
      const extension = extname(page.source);
      const routePath = page.index
        ? join(page.route, `index${extension}`)
        : `${page.route}${extension}`;
      const sourcePath = resolve(docsDirectory, page.source);
      const content = await readFile(sourcePath, "utf8");
      return {
        content: rewriteRoutedLinks({
          content,
          page,
          pages,
          websitePath: source.website.path,
        }),
        destinationPath: resolve(destination, source.website.path, routePath),
        sourcePath,
      };
    }),
  );
};

const sourceStagingPlans = async ({
  assetsDestination,
  destination,
  source,
}: {
  assetsDestination: string;
  destination: string;
  source: DocumentationSource;
}): Promise<StagingPlan[]> => {
  const docsDirectory = resolve(repoRoot, source.directory);
  const files = await walkFiles(docsDirectory);
  const pages = routedPages(source);
  const documents = pages.length
    ? await routedDocumentPlans({ destination, docsDirectory, pages, source })
    : files.filter(isDocument).map((sourcePath) => ({
        destinationPath: resolve(
          destination,
          source.website.path,
          relative(docsDirectory, sourcePath),
        ),
        sourcePath,
      }));
  const assets = files
    .filter((sourcePath) => !isDocument(sourcePath))
    .map((sourcePath) => ({
      destinationPath: resolve(
        assetsDestination,
        source.website.path,
        relative(docsDirectory, sourcePath),
      ),
      sourcePath,
    }));
  return [...documents, ...assets];
};

const createStagingPlans = async ({
  assetsDestination,
  destination,
  sources,
}: StageDocumentationOptions): Promise<StagingPlans> => {
  const plans = (
    await Promise.all(
      sources.map((source) =>
        sourceStagingPlans({ assetsDestination, destination, source }),
      ),
    )
  ).flat();
  return {
    assets: plans.filter(({ sourcePath }) => !isDocument(sourcePath)),
    documents: plans.filter(({ sourcePath }) => isDocument(sourcePath)),
  };
};

const readFileIfPresent = async (path: string) =>
  await readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

const walkFilesIfPresent = async (directory: string) =>
  await walkFiles(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

const syncDirectory = async (staging: string, destination: string) => {
  const [stagedFiles, destinationFiles] = await Promise.all([
    walkFiles(staging),
    walkFilesIfPresent(destination),
  ]);
  const stagedPaths = new Set(
    stagedFiles.map((path) => relative(staging, path)),
  );
  await Promise.all(
    destinationFiles
      .filter((path) => !stagedPaths.has(relative(destination, path)))
      .map((path) => rm(path, { force: true })),
  );
  await Promise.all(
    stagedFiles.map(async (stagedPath) => {
      const destinationPath = resolve(
        destination,
        relative(staging, stagedPath),
      );
      const [content, current] = await Promise.all([
        readFile(stagedPath),
        readFileIfPresent(destinationPath),
      ]);
      if (current?.equals(content)) {
        return;
      }
      await mkdir(dirname(destinationPath), { recursive: true });
      const temporaryPath = `${destinationPath}.${process.pid}.staging`;
      await writeFile(temporaryPath, content);
      await rename(temporaryPath, destinationPath);
    }),
  );
};

const stagePlans = async ({
  destination,
  mode,
  plans,
  stage,
}: {
  destination: string;
  mode: "replace" | "sync";
  plans: readonly StagingPlan[];
  stage?: (directory: string) => Promise<void>;
}) => {
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(`${destination}.staging-`);
  const previous = `${destination}.previous`;
  try {
    await Promise.all(
      plans.map(async ({ content, destinationPath, sourcePath }) => {
        const stagedPath = resolve(
          staging,
          relative(destination, destinationPath),
        );
        await mkdir(dirname(stagedPath), { recursive: true });
        if (content !== undefined) {
          await writeFile(stagedPath, content);
          return;
        }
        await cp(sourcePath, stagedPath, { preserveTimestamps: false });
      }),
    );
    await stage?.(staging);
    if (mode === "sync") {
      await syncDirectory(staging, destination);
      return;
    }
    await rm(previous, { force: true, recursive: true });
    await rename(destination, previous).catch(() => undefined);
    await rename(staging, destination);
    await rm(previous, { force: true, recursive: true });
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
};

const navigationGroupRoute = ({ title }: DocumentationNavigationGroup) =>
  title.toLowerCase().replaceAll(/[^a-z\d]+/g, "-");

const metadata = ({
  description,
  pages = ["..."],
  title,
}: DocumentationMetadata) => ({
  title,
  pages: pages.map((item) =>
    typeof item === "string" ? item : navigationGroupRoute(item),
  ),
  ...(description ? { description } : {}),
});

const rootMetadataEntries = (
  website: DocumentationWebsite,
  titlesByPath: ReadonlyMap<string, string>,
): MetadataEntry[] => {
  const groups = (website.pages ?? []).filter(
    (item): item is DocumentationNavigationGroup => typeof item !== "string",
  );
  const root = {
    ...website,
    pages: website.pages?.map((item) =>
      typeof item === "string" ? `${item}/index` : item,
    ),
  };
  return [
    { path: website.path, website: root },
    ...groups.map((group) => ({
      path: join(website.path, navigationGroupRoute(group)),
      website: {
        pages: group.pages.map((page) => {
          const path = posix.join(website.path, page);
          const title = titlesByPath.get(path) ?? page;
          return `[${title}](/docs/${path})`;
        }),
        title: group.title,
      },
    })),
  ];
};

const routeName = (route: string) => posix.basename(route);

const groupMetadataEntries = (
  group: DocumentationGroup,
  websitePath: string,
): MetadataEntry[] => [
  {
    path: join(websitePath, group.route),
    website: {
      description: group.description,
      pages: group.navigation ?? [
        ...(group.pages ?? [])
          .filter(({ navigation }) => navigation !== false)
          .map(({ route }) => routeName(route)),
        ...(group.groups ?? []).map(({ route }) => routeName(route)),
      ],
      title: group.title,
    },
  },
  ...(group.groups ?? []).flatMap((child) =>
    groupMetadataEntries(child, websitePath),
  ),
];

const sourceMetadataEntries = ({
  website,
}: DocumentationSource): MetadataEntry[] => {
  const generatedNavigation = [
    ...(website.pages ?? [])
      .filter(({ navigation }) => navigation !== false)
      .map(({ route }) => routeName(route)),
    ...(website.groups ?? []).map(({ route }) => routeName(route)),
  ];
  const root = {
    path: website.path,
    website: {
      description: website.description,
      pages:
        website.navigation ??
        (generatedNavigation.length ? generatedNavigation : undefined),
      title: website.title,
    },
  };
  return [
    root,
    ...(website.groups ?? []).flatMap((group) =>
      groupMetadataEntries(group, website.path),
    ),
  ];
};

const stageMetadata = async (
  destination: string,
  roots: readonly DocumentationWebsite[],
  sources: readonly DocumentationSource[],
) => {
  const titlesByPath = new Map(
    sources.map(({ website }) => [website.path, website.title]),
  );
  const entries: MetadataEntry[] = [
    ...roots.flatMap((website) => rootMetadataEntries(website, titlesByPath)),
    ...sources.flatMap(sourceMetadataEntries),
  ];
  await Promise.all(
    entries.map(async ({ path, website }) => {
      const value = metadata(website);
      metaSchema.parse(value);
      const file = resolve(destination, path, "meta.json");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
    }),
  );
};

export const stageDocumentationSources = async (
  options: StageDocumentationOptions,
) => {
  const plans = await createStagingPlans(options);
  await Promise.all([
    stagePlans({
      destination: options.destination,
      mode: options.mode ?? "replace",
      plans: plans.documents,
      stage: (directory) =>
        stageMetadata(directory, options.roots, options.sources),
    }),
    stagePlans({
      destination: options.assetsDestination,
      mode: options.mode ?? "replace",
      plans: plans.assets,
    }),
  ]);
};

export const websiteDocumentationSourceDirectories = documentationSources.map(
  ({ directory }) => resolve(repoRoot, directory),
);

const websiteDocumentationOptions = {
  assetsDestination: generatedAssetsDirectory,
  destination: generatedDirectory,
  roots: documentationRoots,
  sources: documentationSources,
} as const;

export const stageWebsiteDocumentation = async () => {
  await generateAiContextDocumentation();
  await stageDocumentationSources(websiteDocumentationOptions);
};

export const syncWebsiteDocumentation = async () => {
  await generateAiContextDocumentation();
  await stageDocumentationSources({
    ...websiteDocumentationOptions,
    mode: "sync",
  });
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await stageWebsiteDocumentation();
}
