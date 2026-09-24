import { z } from "zod";

const safeRelativeNotificationLink = (link: string) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(link);
  } catch {
    return false;
  }
  return (
    !decoded.startsWith("//") &&
    !decoded.includes("\\") &&
    ![...decoded].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
};

export const notificationLinkSchema = z.union([
  z.string().max(4_096).startsWith("/").refine(safeRelativeNotificationLink),
  z
    .string()
    .max(4_096)
    .url()
    .refine((link) => {
      if (!URL.canParse(link)) {
        return false;
      }
      const url = new URL(link);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    }),
]);

export const notificationSchema = z
  .object({
    body: z.string().max(4_096).optional(),
    open: z.object({ link: notificationLinkSchema }).strict().optional(),
    title: z.string().min(1).max(4_096),
  })
  .strict();

export type Notification = z.infer<typeof notificationSchema>;
