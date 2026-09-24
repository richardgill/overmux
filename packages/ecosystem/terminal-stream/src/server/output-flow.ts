import type {
  TerminalDataMessage,
  TerminalRenderedMessage,
} from "../shared/contracts";

export const defaultTerminalOutputPauseThreshold = 256 * 1_024;
export const defaultTerminalOutputResumeThreshold = 128 * 1_024;

export type TerminalOutputFlowOptions = {
  emit: (message: TerminalDataMessage) => void;
  fail: (cause: unknown) => void;
  outputChunkSize: number;
  pauseOutput: () => void;
  pauseThreshold?: number;
  resumeOutput: () => void;
  resumeThreshold?: number;
  terminalId: string;
};

const validateOptions = ({
  outputChunkSize,
  pauseThreshold,
  resumeThreshold,
}: {
  outputChunkSize: number;
  pauseThreshold: number;
  resumeThreshold: number;
}) => {
  if (!Number.isSafeInteger(outputChunkSize) || outputChunkSize < 1) {
    throw new Error("Terminal output chunk size must be a positive integer");
  }
  if (
    !Number.isSafeInteger(pauseThreshold) ||
    pauseThreshold < 1 ||
    !Number.isSafeInteger(resumeThreshold) ||
    resumeThreshold < 0
  ) {
    throw new Error("Terminal output thresholds must be nonnegative integers");
  }
  if (resumeThreshold > pauseThreshold) {
    throw new Error(
      "Terminal output resume threshold must not exceed its pause threshold",
    );
  }
};

// Sequences one terminal generation's output and bounds bytes awaiting browser rendering.
// Acknowledgements must advance in order, making the byte count exact. A terminal ID makes
// callbacks from a replaced generation stale instead of allowing them to release current bytes.
export const createTerminalOutputFlow = ({
  emit,
  fail,
  outputChunkSize,
  pauseOutput,
  pauseThreshold = defaultTerminalOutputPauseThreshold,
  resumeOutput,
  resumeThreshold = defaultTerminalOutputResumeThreshold,
  terminalId,
}: TerminalOutputFlowOptions) => {
  validateOptions({ outputChunkSize, pauseThreshold, resumeThreshold });

  const unacknowledgedOutput = new Map<number, number>();
  let nextAcknowledgedSequence = 0;
  let nextSequence = 0;
  let unacknowledgedBytes = 0;
  let outputPaused = false;

  // Splits source output into sequenced browser messages and tracks unacknowledged bytes.
  // Pausing at the limit prevents a slow browser from growing server memory without bound.
  const emitOutput = (data: string | Uint8Array) => {
    const bytes = Buffer.from(data);
    for (let offset = 0; offset < bytes.byteLength; offset += outputChunkSize) {
      const chunk = Uint8Array.from(
        bytes.subarray(offset, offset + outputChunkSize),
      );
      const sequence = nextSequence;
      nextSequence += 1;
      unacknowledgedOutput.set(sequence, chunk.byteLength);
      unacknowledgedBytes += chunk.byteLength;
      try {
        emit({ bytes: chunk, sequence, terminalId, type: "data" });
      } catch (cause) {
        // The owner must cancel and clean up its source when failure is reported.
        fail(cause);
        return;
      }
    }
    if (!outputPaused && unacknowledgedBytes >= pauseThreshold) {
      outputPaused = true;
      pauseOutput();
    }
  };

  // Releases rendered chunks in order and resumes source output once backpressure clears.
  const acknowledgeOutput = (message: TerminalRenderedMessage) => {
    if (message.terminalId !== terminalId) {
      return;
    }
    const bytes = unacknowledgedOutput.get(message.sequence);
    // Ordered acknowledgements make the byte count safe to use for backpressure.
    if (message.sequence !== nextAcknowledgedSequence || bytes === undefined) {
      throw new Error("Terminal rendered acknowledgement was out of order");
    }
    unacknowledgedOutput.delete(message.sequence);
    nextAcknowledgedSequence += 1;
    unacknowledgedBytes -= bytes;
    if (outputPaused && unacknowledgedBytes <= resumeThreshold) {
      outputPaused = false;
      resumeOutput();
    }
  };

  return { acknowledgeOutput, emitOutput };
};

export type TerminalOutputFlow = ReturnType<typeof createTerminalOutputFlow>;
