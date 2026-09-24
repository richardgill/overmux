import { z } from "zod";

export const noInputSchema = z.void();

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const parseJsonValue = <T>(value: T): T =>
  jsonValueSchema.parse(value) as T;

export type ContractInputArguments<TInput extends z.ZodType> =
  undefined extends z.input<TInput>
    ? [input?: Exclude<z.input<TInput>, undefined>]
    : [input: z.input<TInput>];

export type ResourceContract<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> = {
  input: TInput;
  output: TOutput;
};

export const defineResourceContract = <
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  contract: ResourceContract<TInput, TOutput>,
): ResourceContract<TInput, TOutput> => contract;

export type StreamContract<
  TInput extends z.ZodType = z.ZodType,
  TClientMessage extends z.ZodType = z.ZodType,
  TServerMessage extends z.ZodType = z.ZodType,
> = {
  clientMessage: TClientMessage;
  input: TInput;
  serverMessage: TServerMessage;
};

export const defineStreamContract = <
  TInput extends z.ZodType,
  TClientMessage extends z.ZodType,
  TServerMessage extends z.ZodType,
>(
  contract: StreamContract<TInput, TClientMessage, TServerMessage>,
): StreamContract<TInput, TClientMessage, TServerMessage> => contract;
