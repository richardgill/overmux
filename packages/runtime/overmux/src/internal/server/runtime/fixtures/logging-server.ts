import { z } from "zod";
import { defineOvermuxServer, noInputSchema } from "../../../../public/index";

export default defineOvermuxServer({
  resources: {
    count: {
      contract: { input: noInputSchema, output: z.number() },
      kind: "subscription",
      read: (_input, { logger }) => {
        logger.info("read-value");
        return 1;
      },
      subscribe: (_input, _invalidate, { logger, signal }) => {
        logger.info("subscribed");
        return () => logger.info("unsubscribed", { aborted: signal.aborted });
      },
    },
  },
  operations: {
    log: {
      input: z.enum(["normal", "failures", "count-flood", "byte-flood"]),
      output: z.string(),
      handle: (mode, { logger }) => {
        logger.debug("operation-debug");
        logger.info("handled");
        logger.warn("operation-warn");
        if (mode === "failures") {
          const cyclic: Record<string, unknown> = {};
          cyclic.self = cyclic;
          logger.error("cyclic", cyclic);
          logger.info("noncloneable", { callback: () => undefined, value: 42 });
          logger.info("oversized", { value: "x".repeat(2 * 1024 * 1024) });
        }
        if (mode === "count-flood" || mode === "byte-flood") {
          const data = {
            value: mode === "byte-flood" ? "x".repeat(100 * 1024) : "small",
          };
          for (let index = 0; index < 10_000; index++) {
            logger.info("flood", data);
          }
        }
        return "not-automatically-logged";
      },
    },
  },
  streams: {
    events: {
      contract: {
        input: noInputSchema,
        clientMessage: z.string(),
        serverMessage: z.string(),
      },
      open: (_input, { logger, signal, emit }) => {
        logger.info("opened");
        return {
          onMessage: () => {
            logger.debug("received");
            emit("acknowledged");
          },
          dispose: () => logger.info("closed", { aborted: signal.aborted }),
        };
      },
    },
  },
});
