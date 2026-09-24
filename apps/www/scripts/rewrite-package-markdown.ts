// Rewrites [Guide](./guide.md#usage) to [Guide](./guide#usage), while leaving external and absolute links unchanged.
const relativeMarkdownLink =
  /(\]\()((?![a-z][a-z\d+.-]*:|\/|#)[^\s)]+)\.md((?:#[^\s)]*)?\))/gi;

export const rewritePackageMarkdownForWebsite = (content: string) =>
  content.replaceAll(relativeMarkdownLink, "$1$2$3");
