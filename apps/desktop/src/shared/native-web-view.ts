import { z } from "zod";

const idSchema = z.string().uuid();
const boundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
const configuration = {
  url: z.string().max(16_384),
  allowedHttpOrigins: z.array(z.string().max(2_048)).max(100),
};

export const nativeWebViewCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), id: idSchema }),
  z.object({ type: z.literal("configure"), id: idSchema, ...configuration }),
  z.object({ type: z.literal("destroy"), id: idSchema }),
]);
export const nativeWebViewBoundsSchema = z.object({
  id: idSchema,
  bounds: boundsSchema,
});
export type NativeWebViewBounds = z.infer<typeof boundsSchema>;
export type NativeWebViewCommand = z.infer<typeof nativeWebViewCommandSchema>;
export type NativeWebViewError = { url: string; code: string; message: string };
