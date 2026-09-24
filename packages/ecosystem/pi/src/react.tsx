import "./styles.css";

import { PierrePatchDiff } from "@overmux/git/react";
import { ChevronRight, Send, Square } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";

type OvermuxStyle = CSSProperties &
  Record<`--${string}`, string | number | undefined>;

type PiContentBlock = {
  arguments?: unknown;
  data?: string;
  id?: string;
  mimeType?: string;
  name?: string;
  text?: string;
  thinking?: string;
  tool?: PiToolProjection;
  type: string;
};

type PiToolResultProjection = {
  content: PiContentBlock[];
  details?: unknown;
  isError: boolean;
  toolCallId: string;
  toolName: string;
};

type PiToolProjection = {
  result?: PiToolResultProjection;
  status: "error" | "pending" | "success";
};

type PiConversationEntry = {
  content: PiContentBlock[];
  errorMessage?: string;
  id: string;
  role: "assistant" | "toolResult" | "user";
  source: "canonical" | "live";
  status: "complete" | "error" | "pending";
  toolName?: string;
};

type PiSessionMetadata = {
  contextUsage?: {
    tokens: number;
    contextWindow: number;
    percent: number;
  };
  model?: {
    provider: string;
    id: string;
    name: string;
  };
  modelOptions?: { provider: string; id: string; name: string }[];
  thinkingLevel: string;
};

type PiConversationSnapshot = {
  agentAvailable: boolean;
  entries: PiConversationEntry[];
  sessionMetadata?: PiSessionMetadata;
  status: "busy" | "degraded" | "idle" | "offline";
};

type PiConversationStream = {
  error?: Error;
  status: "closed" | "open" | "opening";
  subscribe: (
    listener: (snapshot: PiConversationSnapshot) => void,
  ) => () => void;
};

type PiConversationSendRequest = {
  deliverAs: "followUp" | "steer";
  message: string;
};

type PiConversationSendResult = {
  delivery?: "followUp" | "immediate" | "steer";
  requestId?: string;
};

type PiConversationSend = (
  request: PiConversationSendRequest,
) => Promise<PiConversationSendResult | void>;
type PiConversationStop = () => Promise<void>;
type PiConversationSetModel = (model: {
  provider: string;
  id: string;
}) => Promise<void>;
type PiConversationSetThinkingLevel = (
  level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
) => Promise<void>;

type PiConversationClassNames = Partial<{
  composer: string;
  content: string;
  entry: string;
  root: string;
  scroller: string;
  status: string;
}>;

type PiConversationBlockRender = (input: {
  block: PiContentBlock;
  entry: PiConversationEntry;
  index: number;
}) => ReactNode | undefined;

export type ToolStatus = "error" | "pending" | "success";

export type ToolRendererResult = {
  content: { data?: string; text?: string; thinking?: string }[];
  details?: unknown;
  isError: boolean;
};

export type ToolRendererInput = {
  arguments?: unknown;
  result?: ToolRendererResult;
  status: ToolStatus;
  toolName: string;
};

export type ToolRenderer = (input: ToolRendererInput) => ReactNode;

export type ToolRendererRegistry = Record<string, ToolRenderer>;

export type PiConversationProps = {
  autoFocus?: boolean;
  className?: string;
  classNames?: PiConversationClassNames;
  conversation: PiConversationStream;
  emptyState?: ReactNode;
  renderBlock?: PiConversationBlockRender;
  renderers?: ToolRendererRegistry;
  sendMessage: PiConversationSend;
  setModel?: PiConversationSetModel;
  setThinkingLevel?: PiConversationSetThinkingLevel;
  stop?: PiConversationStop;
  style?: OvermuxStyle;
};

const contextWindowOverrides = new Map([
  ["openai-codex/gpt-5.6-luna", 372_000],
  ["openai-codex/gpt-5.6-sol", 372_000],
  ["openai-codex/gpt-5.6-terra", 372_000],
]);

const formatTokenCount = (tokens: number) =>
  tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}k`;

const contextUsageLabel = ({ contextUsage, model }: PiSessionMetadata) => {
  if (!contextUsage) {
    return undefined;
  }
  const contextWindow =
    contextWindowOverrides.get(`${model?.provider}/${model?.id}`) ??
    contextUsage.contextWindow;
  return `ctx ${formatTokenCount(contextUsage.tokens)}/${formatTokenCount(contextWindow)} ${((contextUsage.tokens / contextWindow) * 100).toFixed(1)}%`;
};

const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const PiConversationMetadata = ({
  busy,
  metadata,
  setModel,
  setThinkingLevel,
}: {
  busy: boolean;
  metadata: PiSessionMetadata;
  setModel?: PiConversationSetModel;
  setThinkingLevel?: PiConversationSetThinkingLevel;
}) => {
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const update = async (action: () => Promise<void>) => {
    setChanging(true);
    try {
      await action();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChanging(false);
    }
  };
  const disabled = busy || changing;
  const currentModel = metadata.model;
  return (
    <div className="om-pi-conversation-metadata om-pi-muted">
      {currentModel && metadata.modelOptions?.length && setModel ? (
        <select
          aria-label="Pi model"
          className="om-pi-metadata-select"
          disabled={disabled}
          onChange={(event) =>
            void update(() => setModel(JSON.parse(event.target.value)))
          }
          value={JSON.stringify({
            provider: currentModel.provider,
            id: currentModel.id,
          })}
        >
          {metadata.modelOptions.map((model) => (
            <option
              key={`${model.provider}\0${model.id}`}
              value={JSON.stringify({ provider: model.provider, id: model.id })}
            >
              {model.id}
            </option>
          ))}
        </select>
      ) : (
        <span>{currentModel?.id ?? "no-model"}</span>
      )}
      <span aria-hidden="true"> · </span>
      {setThinkingLevel ? (
        <select
          aria-label="Pi thinking level"
          className="om-pi-metadata-select"
          disabled={disabled}
          onChange={(event) =>
            void update(() =>
              setThinkingLevel(
                event.target
                  .value as Parameters<PiConversationSetThinkingLevel>[0],
              ),
            )
          }
          value={metadata.thinkingLevel}
        >
          {thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      ) : (
        <span>{metadata.thinkingLevel}</span>
      )}
      {contextUsageLabel(metadata) ? (
        <>
          <span aria-hidden="true"> · </span>
          <span>{contextUsageLabel(metadata)}</span>
        </>
      ) : null}
      {error ? (
        <span className="om-pi-metadata-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

const languageLoaders = {
  bash: () => import("@shikijs/langs/bash"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  html: () => import("@shikijs/langs/html"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  markdown: () => import("@shikijs/langs/markdown"),
  nix: () => import("@shikijs/langs/nix"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  yaml: () => import("@shikijs/langs/yaml"),
};

type CodeLanguage = keyof typeof languageLoaders;

const languageAliases: Record<string, CodeLanguage> = {
  js: "javascript",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
};

type HighlightedLine = { color?: string; content: string }[];

type Highlighter = {
  codeToTokens: (
    code: string,
    options: { lang: string; theme: string },
  ) => {
    tokens: HighlightedLine[];
  };
};

const maxHighlightedCodeEntries = 64;

let highlighterPromise: Promise<Highlighter> | undefined;
const highlightedCode = new Map<string, Promise<HighlightedLine[]>>();

const loadHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/tokyo-night"),
    ]).then(async ([core, engine, theme]) =>
      core.createHighlighterCore({
        engine: engine.createJavaScriptRegexEngine(),
        langs: await Promise.all(
          Object.values(languageLoaders).map(async (loadLanguage) =>
            loadLanguage(),
          ),
        ),
        themes: [theme.default],
      }),
    );
  }
  return highlighterPromise;
};

void loadHighlighter();

const highlighted = (code: string, language: string) => {
  const key = `${language}\u0000${code}`;
  const cached = highlightedCode.get(key);
  if (cached) {
    return cached;
  }
  const next = loadHighlighter().then(
    (highlighter) =>
      highlighter.codeToTokens(code, { lang: language, theme: "tokyo-night" })
        .tokens,
  );
  highlightedCode.set(key, next);
  if (highlightedCode.size > maxHighlightedCodeEntries) {
    const oldest = highlightedCode.keys().next().value;
    if (oldest) {
      highlightedCode.delete(oldest);
    }
  }
  return next;
};

const textOf = (block: PiContentBlock) =>
  block.text ??
  block.thinking ??
  (typeof block.data === "string" ? block.data : "");

const formatted = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
};

const codeLanguage = (className?: string): CodeLanguage | undefined => {
  const match = /language-([^\s]+)/.exec(className ?? "");
  const language = match?.[1]?.toLowerCase();
  if (!language) {
    return undefined;
  }
  const normalized = languageAliases[language] ?? language;
  return Object.hasOwn(languageLoaders, normalized)
    ? (normalized as CodeLanguage)
    : undefined;
};

const FencedCode = ({
  children,
  className,
  node: _node,
  ...props
}: Components["code"] extends infer Component
  ? Component extends (props: infer Props) => unknown
    ? Props
    : never
  : never) => {
  const code = String(children).replace(/\n$/, "");
  const language = codeLanguage(className);
  const highlightKey = language ? `${language}\u0000${code}` : undefined;
  const [highlightedState, setHighlightedState] = useState<{
    key: string;
    lines: HighlightedLine[];
  }>();
  const lines =
    highlightedState && highlightedState.key === highlightKey
      ? highlightedState.lines
      : undefined;

  useEffect(() => {
    if (!language || !highlightKey) {
      return;
    }
    let active = true;
    void highlighted(code, language).then((value) => {
      if (active) {
        setHighlightedState({ key: highlightKey, lines: value });
      }
    });
    return () => {
      active = false;
    };
  }, [code, highlightKey, language]);

  if (!language || !lines) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code className="om-pi-code-highlighted" {...props}>
      {lines.map((line, index) => (
        <span className="om-pi-code-line" key={index}>
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
          {index < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </code>
  );
};

const markdownComponents: Components = { code: FencedCode };

const MarkdownPart = ({
  block,
  subdued = false,
}: {
  block: PiContentBlock;
  subdued?: boolean;
}) => (
  <div
    className={["om-pi-markdown", subdued && "om-pi-muted"]
      .filter(Boolean)
      .join(" ")}
  >
    <ReactMarkdown components={markdownComponents}>
      {textOf(block)}
    </ReactMarkdown>
  </div>
);

const preview = (value: string, maxLength = 120) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const bounded = (value: string, maxLines = 200, maxLength = 20_000) => {
  const lines = value.split("\n").slice(0, maxLines).join("\n");
  return lines.length > maxLength ? `${lines.slice(0, maxLength - 1)}…` : lines;
};

const detailsRecord = (details: unknown) =>
  typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;

const resultText = (result: ToolRendererResult | undefined) =>
  result?.content
    .map((block) => block.text ?? block.thinking ?? block.data ?? "")
    .filter(Boolean)
    .join("\n") ?? "";

const truncationSummary = (details: unknown) => {
  const truncation = detailsRecord(details)?.truncation;
  const record = detailsRecord(truncation);
  if (!record?.truncated) {
    return undefined;
  }
  const totalLines =
    typeof record.totalLines === "number" ? record.totalLines : undefined;
  const outputLines =
    typeof record.outputLines === "number" ? record.outputLines : undefined;
  return totalLines && outputLines
    ? `${totalLines - outputLines} lines omitted`
    : "Output truncated";
};

const ToolDisclosure = ({
  children,
  collapsible = true,
  indicator,
  label,
  status,
}: {
  children?: ReactNode;
  collapsible?: boolean;
  indicator?: ReactNode;
  label: ReactNode;
  status: ToolStatus;
}) => {
  const [open, setOpen] = useState(status !== "success");
  const explicit = useRef(false);
  useEffect(() => {
    if (!explicit.current) {
      setOpen(status !== "success");
    }
  }, [status]);
  const header = (
    <>
      <span
        className={`om-pi-tool-status${indicator ? " om-pi-tool-status-label" : ""}`}
        aria-label={`Tool ${status}`}
      >
        {indicator ??
          (status === "success" ? "✓" : status === "error" ? "×" : "●")}
      </span>
      {label}
    </>
  );
  if (!collapsible) {
    return (
      <div className="om-pi-tool-details" data-om-tool-status={status}>
        <div className="om-pi-tool-summary">{header}</div>
        {children ? <div className="om-pi-tool-body">{children}</div> : null}
      </div>
    );
  }
  return (
    <details
      className="om-pi-tool-details"
      data-om-tool-status={status}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary
        onClick={() => {
          explicit.current = true;
        }}
      >
        {header}
      </summary>
      {children ? <div className="om-pi-tool-body">{children}</div> : null}
    </details>
  );
};

const ThinkingPart = ({
  block,
  status,
}: {
  block: PiContentBlock;
  status: PiConversationEntry["status"];
}) => {
  const thinking = textOf(block);
  const [open, setOpen] = useState(status === "pending");
  const explicit = useRef(false);
  useEffect(() => {
    if (!explicit.current) {
      setOpen(status === "pending");
    }
  }, [status]);
  return (
    <details
      className="om-pi-thinking"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary
        onClick={() => {
          explicit.current = true;
        }}
      >
        {status === "pending" && thinking ? preview(thinking) : "Thinking…"}
      </summary>
      <div className="om-pi-content-block">
        <MarkdownPart block={block} subdued />
      </div>
    </details>
  );
};

const ImagePart = ({ block }: { block: PiContentBlock }) => (
  <p className="om-pi-muted">Image attachment {block.mimeType ?? ""}</p>
);

const toolStatus = (tool: PiToolProjection): ToolStatus =>
  tool.result?.isError ? "error" : tool.result ? "success" : tool.status;

const argumentsRecord = (arguments_: unknown) =>
  typeof arguments_ === "object" && arguments_ !== null
    ? (arguments_ as Record<string, unknown>)
    : undefined;

const stringArgument = (arguments_: unknown, name: string) => {
  const value = argumentsRecord(arguments_)?.[name];
  return typeof value === "string" ? value : undefined;
};

const numberArgument = (arguments_: unknown, name: string) => {
  const value = argumentsRecord(arguments_)?.[name];
  return typeof value === "number" ? value : undefined;
};

const Output = ({ result }: { result?: ToolRendererResult }) => {
  const content = resultText(result);
  if (!content && !result?.isError) {
    return null;
  }
  return (
    <pre className={result?.isError ? "om-pi-tool-error" : "om-pi-tool-output"}>
      {bounded(content || formatted(result?.details))}
    </pre>
  );
};

const toolFrame = (
  { result, status }: ToolRendererInput,
  label: ReactNode,
  children?: ReactNode,
) => (
  <ToolDisclosure label={label} status={status}>
    {children}
    <Output result={result} />
  </ToolDisclosure>
);

const ToolSection = ({
  children,
  defaultOpen,
  label,
  status,
}: {
  children?: ReactNode;
  defaultOpen?: boolean;
  label: ReactNode;
  status: ToolStatus;
}) => {
  const shouldOpen = defaultOpen ?? status !== "success";
  const [open, setOpen] = useState(shouldOpen);
  const explicit = useRef(false);
  useEffect(() => {
    if (!explicit.current) {
      setOpen(shouldOpen);
    }
  }, [shouldOpen]);
  return (
    <details
      className="om-pi-tool-section"
      data-om-tool-status={status}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary
        onClick={() => {
          explicit.current = true;
        }}
      >
        <ChevronRight aria-hidden="true" />
        <span>{label}</span>
      </summary>
      {children ? <div className="om-pi-tool-body">{children}</div> : null}
    </details>
  );
};

const BashToolRenderer: ToolRenderer = (input) => {
  const command = stringArgument(input.arguments, "command");
  const truncation = truncationSummary(input.result?.details);
  return (
    <div className="om-pi-tool-details" data-om-tool-status={input.status}>
      <div className="om-pi-tool-kind">
        <span
          className="om-pi-tool-status om-pi-tool-status-label"
          aria-label={`Tool ${input.status}`}
        >
          bash
        </span>
      </div>
      <pre className="om-pi-tool-command">
        <code>$ {command ?? "bash"}</code>
      </pre>
      <ToolSection label="Logs" status={input.status}>
        {truncation ? <p className="om-pi-tool-field">{truncation}</p> : null}
        <Output result={input.result} />
      </ToolSection>
    </div>
  );
};

const BashProcessToolRenderer: ToolRenderer = (input) => {
  const action = stringArgument(input.arguments, "action") ?? "bash_process";
  const pgid =
    numberArgument(input.arguments, "pgid") ??
    stringArgument(input.arguments, "pgid");
  return toolFrame(input, `${action}${pgid === undefined ? "" : ` · ${pgid}`}`);
};

const languageForPath = (path: string | undefined) => {
  const extension = path?.split(".").at(-1)?.toLowerCase();
  return extension ? (languageAliases[extension] ?? extension) : "";
};

const ReadToolRenderer: ToolRenderer = (input) => {
  const path = stringArgument(input.arguments, "path");
  const offset = numberArgument(input.arguments, "offset") ?? 1;
  const limit = numberArgument(input.arguments, "limit");
  const range =
    limit === undefined ? `:${offset}` : `:${offset}-${offset + limit - 1}`;
  const content = resultText(input.result);
  const language = languageForPath(path);
  return (
    <ToolDisclosure
      indicator="read"
      label={`${path ?? "read"}${range}`}
      status={input.status}
    >
      {input.result?.isError ? <Output result={input.result} /> : null}
      {content && !input.result?.isError ? (
        <MarkdownPart
          block={{
            text: `\`\`\`${language}\n${bounded(content)}\n\`\`\``,
            type: "text",
          }}
          subdued
        />
      ) : null}
    </ToolDisclosure>
  );
};

type EditResultDetails = { diff: string; patch?: string };

const editResultDetails = (details: unknown): EditResultDetails | undefined => {
  const record = detailsRecord(details);
  return typeof record?.diff === "string"
    ? {
        diff: record.diff,
        patch: typeof record.patch === "string" ? record.patch : undefined,
      }
    : undefined;
};

const EditToolRenderer: ToolRenderer = (input) => {
  const details = editResultDetails(input.result?.details);
  const diff = details?.diff;
  const path = stringArgument(input.arguments, "path") ?? "edit";
  const label = <code className="om-pi-tool-path">{path}</code>;
  return (
    <ToolDisclosure
      collapsible={false}
      indicator="edit"
      label={label}
      status={input.status}
    >
      {diff ? (
        <div className="om-pi-tool-diff">
          {details?.patch ? (
            <PierrePatchDiff
              options={{ hunkSeparators: "simple" }}
              patch={details.patch}
            />
          ) : (
            <pre>{bounded(diff)}</pre>
          )}
        </div>
      ) : null}
      {input.result?.isError ? (
        <ToolSection defaultOpen={false} label="Error" status={input.status}>
          <Output result={input.result} />
        </ToolSection>
      ) : null}
    </ToolDisclosure>
  );
};

const newFilePatch = (path: string, content: string) => {
  const safePath = path.replace(/[\r\n]/g, "_");
  const displayed = bounded(content);
  const hasTrailingNewline = displayed.endsWith("\n");
  const lines = displayed ? displayed.split("\n") : [];
  const additions = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const hunk = additions.length
    ? `@@ -0,0 +1,${additions.length} @@\n${additions.map((line) => `+${line}`).join("\n")}${hasTrailingNewline ? "\n" : ""}`
    : "";
  return `diff --git a/${safePath} b/${safePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${safePath}\n${hunk}`;
};

const WriteToolRenderer: ToolRenderer = (input) => {
  const path = stringArgument(input.arguments, "path") ?? "write";
  const content = stringArgument(input.arguments, "content");
  const label = <code className="om-pi-tool-path">{path}</code>;
  return (
    <ToolDisclosure
      collapsible={false}
      indicator="write"
      label={label}
      status={input.status}
    >
      {content === undefined ? null : (
        <div
          className="om-pi-tool-diff"
          data-patch={newFilePatch(path, content)}
        >
          <PierrePatchDiff
            options={{ hunkSeparators: "simple" }}
            patch={newFilePatch(path, content)}
          />
        </div>
      )}
      {input.result?.isError ? (
        <ToolSection defaultOpen={false} label="Error" status={input.status}>
          <Output result={input.result} />
        </ToolSection>
      ) : null}
    </ToolDisclosure>
  );
};

const GenericToolRenderer: ToolRenderer = (input) =>
  toolFrame(
    input,
    input.toolName,
    input.arguments === undefined ? null : (
      <pre className="om-pi-tool-input">{formatted(input.arguments)}</pre>
    ),
  );

export const defaultToolRenderers: ToolRendererRegistry = {
  bash: BashToolRenderer,
  bash_process: BashProcessToolRenderer,
  edit: EditToolRenderer,
  read: ReadToolRenderer,
  write: WriteToolRenderer,
};

const ToolPart = ({
  block,
  entry,
  renderers,
}: {
  block: PiContentBlock;
  entry: PiConversationEntry;
  renderers: ToolRendererRegistry;
}) => {
  const knownToolName = block.name ?? entry.toolName;
  const tool = block.tool ?? { status: "pending" as const };
  if (!knownToolName && tool.status === "pending") {
    return (
      <p className="om-pi-muted" role="status">
        Running tool…
      </p>
    );
  }
  const toolName = knownToolName ?? "Tool call";
  const Renderer = renderers[toolName] ?? GenericToolRenderer;
  return (
    <Renderer
      arguments={block.arguments}
      result={tool.result}
      status={toolStatus(tool)}
      toolName={toolName}
    />
  );
};

const MessagePart = ({
  block,
  entry,
  renderers,
}: {
  block: PiContentBlock;
  entry: PiConversationEntry;
  renderers: ToolRendererRegistry;
}) => {
  if (block.type === "thinking") {
    return <ThinkingPart block={block} status={entry.status} />;
  }
  if (block.type === "toolCall") {
    return <ToolPart block={block} entry={entry} renderers={renderers} />;
  }
  if (block.type === "image") {
    return <ImagePart block={block} />;
  }
  return <MarkdownPart block={block} />;
};

const roleName = (entry: PiConversationEntry) => {
  if (entry.role === "toolResult") {
    return entry.toolName ? `${entry.toolName} result` : "Tool result";
  }
  return entry.role === "user" ? "You" : "Pi";
};

const PiConversationMessage = ({
  className,
  entry,
  renderBlock,
  renderers,
}: {
  className?: string;
  entry: PiConversationEntry;
  renderBlock?: PiConversationBlockRender;
  renderers: ToolRendererRegistry;
}) => (
  <article
    aria-label={`${roleName(entry)} message`}
    className={["om-pi-conversation-entry", className]
      .filter(Boolean)
      .join(" ")}
    data-om-role={entry.role}
    data-om-source={entry.source}
    data-om-status={entry.status}
  >
    {entry.role === "user" || entry.status !== "complete" ? (
      <header className="om-pi-muted">
        {entry.role === "user" ? <span>You</span> : null}
        {entry.status === "pending" ? (
          <span role="status">Streaming…</span>
        ) : null}
        {entry.status === "error" ? (
          <span className="om-pi-tool-error">Error</span>
        ) : null}
      </header>
    ) : null}
    <div className="om-pi-content-block">
      {entry.content.map((block, index) => (
        <div key={`${block.type}:${block.id ?? index}`}>
          {renderBlock?.({ block, entry, index }) ?? (
            <MessagePart block={block} entry={entry} renderers={renderers} />
          )}
        </div>
      ))}
      {!entry.content.length && entry.status === "pending" ? (
        <p className="om-pi-muted" role="status">
          Waiting for output…
        </p>
      ) : null}
    </div>
    {entry.errorMessage ? (
      <p className="om-pi-conversation-error" role="alert">
        {entry.errorMessage}
      </p>
    ) : null}
  </article>
);

const statusLabel = (status: "busy" | "degraded" | "idle" | "offline") => {
  if (status === "busy") {
    return "Pi is working";
  }
  if (status === "degraded") {
    return "Pi updates are degraded";
  }
  if (status === "idle") {
    return "Pi is ready";
  }
  return "Pi is offline";
};

export type PiMessageComposerProps = {
  autoFocus?: boolean;
  available: boolean;
  busy?: boolean;
  className?: string;
  sendMessage: PiConversationSend;
  stop?: PiConversationStop;
  style?: OvermuxStyle;
};

export const PiMessageComposer = ({
  autoFocus = false,
  available,
  busy = false,
  className,
  sendMessage,
  stop,
  style,
}: PiMessageComposerProps) => {
  const messageId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState<"followUp" | "steer">();
  const [stopping, setStopping] = useState(false);
  const actionsVisible = focused || Boolean(draft);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [draft]);
  useLayoutEffect(() => {
    if (autoFocus && available) {
      textareaRef.current?.focus();
    }
  }, [autoFocus, available]);
  const submit = async (deliverAs: "followUp" | "steer") => {
    const message = draft.trim();
    if (!message || !available || sending || stopping) {
      return;
    }
    setSending(deliverAs);
    try {
      await sendMessage({ deliverAs, message });
      setDraft("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(undefined);
    }
  };
  const abort = async () => {
    if (!available || !busy || !stop || sending || stopping) {
      return;
    }
    setStopping(true);
    try {
      await stop();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopping(false);
    }
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit("steer");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
      return;
    }
    event.preventDefault();
    void submit(busy && event.shiftKey ? "followUp" : "steer");
  };
  return (
    <form
      className={["om-pi-composer", className].filter(Boolean).join(" ")}
      data-om-pi-composer
      onSubmit={onSubmit}
      style={style}
    >
      <div className="om-pi-composer-box">
        <label className="om-pi-visually-hidden" htmlFor={messageId}>
          Message Pi
        </label>
        <textarea
          className={[
            "om-pi-composer-textarea",
            busy && !actionsVisible
              ? "om-pi-composer-textarea-with-stop"
              : undefined,
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={!available || Boolean(sending) || stopping}
          id={messageId}
          onBlur={() => setFocused(false)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={available ? "Message Pi…" : "Pi is offline"}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        {busy && !actionsVisible ? (
          <button
            aria-label={stopping ? "Stopping Pi" : "Stop Pi"}
            className="om-pi-composer-stop om-pi-composer-stop-inline"
            disabled={!available || !stop || Boolean(sending) || stopping}
            onClick={() => void abort()}
            title="Stop Pi"
            type="button"
          >
            <Square aria-hidden="true" />
          </button>
        ) : null}
        <div className="om-pi-composer-actions">
          <span className="om-pi-muted">Ctrl/⌘ Enter · Shift queues</span>
          {busy ? (
            <>
              {actionsVisible ? (
                <button
                  aria-label={stopping ? "Stopping Pi" : "Stop Pi"}
                  className="om-pi-composer-stop"
                  disabled={!available || !stop || Boolean(sending) || stopping}
                  onClick={() => void abort()}
                  title="Stop Pi"
                  type="button"
                >
                  <Square aria-hidden="true" />
                </button>
              ) : null}
              <button
                aria-label="Follow up after the current turn"
                className="om-pi-composer-follow-up"
                disabled={
                  !available || !draft.trim() || Boolean(sending) || stopping
                }
                onClick={() => void submit("followUp")}
                type="button"
              >
                {sending === "followUp" ? "Queueing…" : "Follow up"}
              </button>
            </>
          ) : null}
          <button
            className="om-pi-composer-send"
            disabled={
              !available || !draft.trim() || Boolean(sending) || stopping
            }
            type="submit"
          >
            <Send aria-hidden="true" />
            {sending === "steer" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      {error ? (
        <p className="om-pi-conversation-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
};

export const PiConversation = ({
  autoFocus = false,
  conversation,
  className,
  classNames = {},
  emptyState,
  renderBlock,
  renderers,
  sendMessage,
  setModel,
  setThinkingLevel,
  stop,
  style,
}: PiConversationProps) => {
  const [snapshot, setSnapshot] = useState<PiConversationSnapshot>();
  useLayoutEffect(() => conversation.subscribe(setSnapshot), [conversation]);
  const error = conversation.error?.message;
  const status = snapshot?.status ?? "offline";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const toolRenderers = { ...defaultToolRenderers, ...renderers };
  const scrollToLatest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    followingRef.current = true;
    setFollowing(true);
    scroller.scrollTop = scroller.scrollHeight;
  }, []);
  const updateFollowing = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const next =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    followingRef.current = next;
    setFollowing(next);
  }, []);
  useLayoutEffect(() => {
    if (followingRef.current) {
      scrollToLatest();
    }
  }, [scrollToLatest, snapshot]);
  return (
    <section
      aria-label="Pi conversation"
      className={["om-pi-conversation", className, classNames.root]
        .filter(Boolean)
        .join(" ")}
      data-om-agent-status={status}
      data-om-pi-conversation
      style={style}
    >
      <header
        className={["om-pi-conversation-status", classNames.status]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="om-pi-conversation-status-row">
          <strong>Pi conversation</strong>
          <span aria-live="polite" className="om-pi-muted" role="status">
            {!snapshot && !error ? "Connecting to Pi…" : statusLabel(status)}
          </span>
        </div>
      </header>
      {error ? (
        <p className="om-pi-conversation-error" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className={["om-pi-conversation-scroller", classNames.scroller]
          .filter(Boolean)
          .join(" ")}
        onScroll={updateFollowing}
        ref={scrollerRef}
        tabIndex={0}
      >
        <div
          className={["om-pi-conversation-content", classNames.content]
            .filter(Boolean)
            .join(" ")}
        >
          {snapshot?.entries.map((entry) => (
            <PiConversationMessage
              className={["om-pi-conversation-entry", classNames.entry]
                .filter(Boolean)
                .join(" ")}
              entry={entry}
              key={entry.id}
              renderBlock={renderBlock}
              renderers={toolRenderers}
            />
          ))}
          {snapshot && !snapshot.entries.length
            ? (emptyState ?? (
                <p className="om-pi-muted">No conversation yet.</p>
              ))
            : null}
          {!snapshot && error ? (
            <p className="om-pi-muted">
              Conversation unavailable while Pi is offline.
            </p>
          ) : null}
        </div>
      </div>
      {!following ? (
        <button
          className="om-pi-conversation-jump"
          onClick={scrollToLatest}
          type="button"
        >
          Jump to latest
        </button>
      ) : null}
      <PiMessageComposer
        autoFocus={autoFocus}
        available={snapshot?.agentAvailable === true}
        busy={status === "busy"}
        className={classNames.composer}
        sendMessage={sendMessage}
        stop={stop}
      />
      {snapshot?.sessionMetadata ? (
        <PiConversationMetadata
          busy={status === "busy"}
          metadata={snapshot.sessionMetadata}
          setModel={setModel}
          setThinkingLevel={setThinkingLevel}
        />
      ) : null}
    </section>
  );
};
