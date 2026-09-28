import { Stream } from "@cloudflare/stream-react";
import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

export const READMEHeading = ({ children }: ComponentProps<"h2">) => (
  <h2 className="scroll-mt-20" id={children === "Demo" ? "demo" : undefined}>
    {children}
  </h2>
);

export const READMEParagraph = ({
  node,
  ...props
}: ComponentProps<"p"> & ExtraProps) => {
  const link = node?.children.length === 1 ? node.children[0] : undefined;
  const image =
    link?.type === "element" &&
    link.tagName === "a" &&
    link.properties.href === "https://overmux.com/#demo" &&
    link.children.length === 1
      ? link.children[0]
      : undefined;

  if (image?.type !== "element" || image.tagName !== "img") {
    return <p {...props} />;
  }

  return (
    <div className="aspect-video">
      <Stream
        src="b568fcbbe38b9b139d78643bd24f1afa"
        customerCode="vg0wuzs3im0xeh1d"
        controls
        responsive
        title="Overmux demo"
        poster={String(image.properties.src)}
      />
    </div>
  );
};
