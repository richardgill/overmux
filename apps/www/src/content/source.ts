import { allPackageDocs, allPackageMetas } from "content-collections";
import { createMDXSource } from "@fumadocs/content-collections";
import { loader } from "fumadocs-core/source";

export const source = loader({
  baseUrl: "/docs",
  source: createMDXSource(allPackageDocs, allPackageMetas),
});

export const formattedTitles = () =>
  Object.fromEntries(
    source
      .getPages()
      .map((page) => [page.url, page.data.formattedTitle ?? page.data.title]),
  );

export const getLLMText = (page: (typeof source)["$inferPage"]) =>
  `# ${page.data.title} (${page.url})\n\n${page.data.content}`;
