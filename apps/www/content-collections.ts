import {
  defineCollection,
  defineConfig,
  type Context,
  type Meta,
} from "@content-collections/core";
import { transformMDX } from "@fumadocs/content-collections/configuration";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";
import { inlineTitleText } from "./src/content/inline-title";
import { rewritePackageMarkdownForWebsite } from "./scripts/rewrite-package-markdown";

type ContentDocument = { _meta: Meta; content: string; title: string };

const transformCommonMark = async <D extends ContentDocument>(
  document: D,
  context: Context,
) => {
  const content = rewritePackageMarkdownForWebsite(document.content);
  const transformed = await transformMDX({ ...document, content }, context);
  return {
    ...transformed,
    content: document.content,
    formattedTitle: document.title,
    title: inlineTitleText(document.title),
  };
};

const packageDocs = defineCollection({
  name: "packageDocs",
  directory: "generated/package-docs",
  include: "**/*.{md,mdx}",
  schema: pageSchema.extend({
    content: z.string(),
    formattedTitle: z.string().optional(),
  }),
  transform: transformCommonMark,
});

const packageMetas = defineCollection({
  name: "packageMetas",
  directory: "generated/package-docs",
  include: "**/meta.json",
  parser: "json",
  schema: metaSchema,
});

export default defineConfig({
  content: [packageDocs, packageMetas],
});
