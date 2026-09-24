// Delivers sequenced output to a terminal renderer without overwhelming it.
// A terminal ID identifies one server-side terminal generation. A new generation resets the
// renderer, while late output and renderer callbacks from replaced generations are ignored.
// Render acknowledgements are sent in order only after the renderer processes each write.
import type {
  TerminalDataMessage,
  TerminalRenderedMessage,
} from "../shared/contracts";

export type TerminalSink = {
  // Clears output from the previous server-side terminal generation.
  reset: () => void;
  // Renders bytes and reports when they have been processed rather than merely queued.
  write: (bytes: Uint8Array, onProcessed: () => void) => void;
};

export type TerminalOutputProcessorOptions = {
  onFailure: (error: Error) => void;
  sendRendered: (message: TerminalRenderedMessage) => boolean;
  sink: TerminalSink;
};

type RenderTask = {
  message: TerminalDataMessage;
  processed: boolean;
  terminalGeneration: number;
};

const pauseAfterOutstandingWrites = 10;
const resumeBelowOutstandingWrites = 4;

export const createTerminalOutputProcessor = ({
  onFailure,
  sendRendered,
  sink,
}: TerminalOutputProcessorOptions) => {
  // Connection lifecycle
  let connectionOpen = true;
  let disposed = false;

  // Active server terminal
  const seenTerminalIds = new Set<string>();
  let nextExpectedSequence = 0;
  let resetBeforeNextWrite = false;
  let terminalId: string | undefined;
  let terminalGeneration = 0;

  // Rendering and backpressure
  let queuedOutput: TerminalDataMessage[] = [];
  let renderingPaused = false;
  let renderingQueuedOutput = false;
  let writesAwaitingAcknowledgement: RenderTask[] = [];

  const outstandingWriteCount = () =>
    writesAwaitingAcknowledgement.filter((task) => !task.processed).length;

  const discardPendingOutput = () => {
    terminalGeneration += 1;
    queuedOutput = [];
    renderingPaused = false;
    writesAwaitingAcknowledgement = [];
  };

  const activateTerminal = (nextTerminalId: string) => {
    if (nextTerminalId === terminalId) {
      return true;
    }
    if (seenTerminalIds.has(nextTerminalId)) {
      return false;
    }
    seenTerminalIds.add(nextTerminalId);
    terminalId = nextTerminalId;
    nextExpectedSequence = 0;
    discardPendingOutput();
    // Wait until valid output is ready before resetting the renderer.
    resetBeforeNextWrite = true;
    return true;
  };

  const fail = (message: string) => {
    connectionOpen = false;
    discardPendingOutput();
    onFailure(new Error(message));
  };

  const acknowledgeProcessedWritesInOrder = () => {
    const write = writesAwaitingAcknowledgement[0];
    if (!write?.processed) {
      return;
    }
    writesAwaitingAcknowledgement.shift();
    if (
      !sendRendered({
        sequence: write.message.sequence,
        terminalId: write.message.terminalId,
        type: "rendered",
      })
    ) {
      fail("Terminal acknowledgement could not be sent");
      return;
    }
    // Callbacks may finish 2, 0, 1, but acknowledgements must remain 0, 1, 2.
    acknowledgeProcessedWritesInOrder();
  };

  const markWriteProcessed = (write: RenderTask) => {
    // Callbacks from an earlier terminal generation must not affect the current one.
    if (write.terminalGeneration !== terminalGeneration || write.processed) {
      return;
    }
    write.processed = true;
    acknowledgeProcessedWritesInOrder();
    if (disposed || !connectionOpen) {
      return;
    }
    if (
      renderingPaused &&
      outstandingWriteCount() < resumeBelowOutstandingWrites
    ) {
      renderingPaused = false;
    }
    renderQueuedOutput();
  };

  const renderQueuedOutput = () => {
    // Renderer callbacks may be synchronous, so prevent re-entry while rendering.
    if (
      disposed ||
      !connectionOpen ||
      renderingQueuedOutput ||
      renderingPaused
    ) {
      return;
    }
    renderingQueuedOutput = true;
    const outputToRender = queuedOutput;
    queuedOutput = [];
    outputToRender.forEach((message) => {
      if (disposed || !connectionOpen || renderingPaused) {
        queuedOutput.push(message);
        return;
      }
      if (message.sequence !== nextExpectedSequence) {
        fail("Terminal output arrived out of order");
        return;
      }
      if (resetBeforeNextWrite) {
        resetBeforeNextWrite = false;
        sink.reset();
      }
      nextExpectedSequence += 1;
      const write: RenderTask = {
        message,
        processed: false,
        terminalGeneration,
      };
      writesAwaitingAcknowledgement.push(write);
      sink.write(message.bytes, () => markWriteProcessed(write));
      // Pause above ten and resume below four to let the renderer catch up.
      if (outstandingWriteCount() > pauseAfterOutstandingWrites) {
        renderingPaused = true;
      }
    });
    renderingQueuedOutput = false;
    if (queuedOutput.length > 0) {
      renderQueuedOutput();
    }
  };

  return {
    close: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Invalidate pending callbacks before the renderer or transport can complete them.
      discardPendingOutput();
    },
    connectionClosed: () => {
      if (disposed || !connectionOpen) {
        return;
      }
      connectionOpen = false;
      discardPendingOutput();
    },
    connectionOpening: () => {
      if (disposed || connectionOpen) {
        return;
      }
      connectionOpen = true;
      nextExpectedSequence = 0;
      seenTerminalIds.clear();
      terminalId = undefined;
    },
    enqueue: (message: TerminalDataMessage) => {
      if (
        disposed ||
        !connectionOpen ||
        !activateTerminal(message.terminalId)
      ) {
        return;
      }
      queuedOutput.push(message);
      renderQueuedOutput();
    },
  };
};

export type TerminalOutputProcessor = ReturnType<
  typeof createTerminalOutputProcessor
>;
