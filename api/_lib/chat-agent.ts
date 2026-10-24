/**
 * Tool-calling agent loop over OpenRouter chat completions.
 */
import {
  buildChatSystemPrompt,
  CHAT_AGENT_DEADLINE_MS,
  CHAT_MAX_TOOL_STEPS,
  resolveOpenRouterModel,
  type MoveScoringWindowKey,
} from "./chat-config.js";
import {
  buildInitialMessages,
  callOpenRouterWithFallback,
  ChatAgentTimeoutError,
  type ChatCompletionMessage,
  type OpenRouterFetch,
} from "./chat-openrouter.js";
import {
  CHAT_TOOL_DEFINITIONS,
  dispatchChatTool,
  parseToolCallArguments,
  type ChatToolContext,
} from "./chat-tools.js";

export type AgentHistoryMessage = { role: "user" | "assistant"; content: string };

export type RunChatAgentArgs = {
  apiKey: string;
  userMessage: string;
  history?: AgentHistoryMessage[];
  ctx: ChatToolContext;
  /** Full system prompt (scoring window + preferences). Built by /api/chat. */
  systemPrompt?: string;
  scoringWindow?: MoveScoringWindowKey;
  fetchImpl?: OpenRouterFetch;
  maxToolSteps?: number;
  primaryModel?: string;
  fallbackModel?: string;
  deadlineMs?: number;
  /** Injectable dispatcher for unit tests. */
  dispatchTool?: typeof dispatchChatTool;
};

export type RunChatAgentResult = {
  reply: string;
  model: string;
  toolSteps: number;
};

function assistantContent(message: ChatCompletionMessage): string {
  return typeof message.content === "string" ? message.content.trim() : "";
}

/** Reject when the agent deadline aborts, even if the underlying tool never sees a signal. */
function awaitWithAgentDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void operation.catch(() => undefined);
      reject(new ChatAgentTimeoutError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function runChatAgent(args: RunChatAgentArgs): Promise<RunChatAgentResult> {
  const maxSteps = args.maxToolSteps ?? CHAT_MAX_TOOL_STEPS;
  const dispatch = args.dispatchTool ?? dispatchChatTool;
  const scoringWindow = args.scoringWindow ?? args.ctx.scoringWindow ?? "week";
  args.ctx.scoringWindow = scoringWindow;
  const messages = buildInitialMessages(
    args.history ?? [],
    args.userMessage,
    args.systemPrompt ?? buildChatSystemPrompt(scoringWindow),
  );
  const deadlineMs = args.deadlineMs ?? CHAT_AGENT_DEADLINE_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let modelUsed = "";
  let toolSteps = 0;
  // Once a round falls back, stay on that model for the rest of this answer
  // rather than retrying the failing primary on every tool step.
  let stickyModel: string | undefined;

  try {
    for (let step = 0; step <= maxSteps; step += 1) {
      if (controller.signal.aborted) throw new ChatAgentTimeoutError();

      const { response, model } = await callOpenRouterWithFallback({
        apiKey: args.apiKey,
        messages,
        tools: CHAT_TOOL_DEFINITIONS,
        fetchImpl: args.fetchImpl,
        primaryModel: stickyModel ?? args.primaryModel,
        fallbackModel: stickyModel ?? args.fallbackModel,
        signal: controller.signal,
      });
      if (!stickyModel && model !== (args.primaryModel ?? resolveOpenRouterModel())) stickyModel = model;
      modelUsed = model;
      const choice = response.choices[0];
      if (!choice) {
        return { reply: "No response from the model.", model: modelUsed, toolSteps };
      }
      const message = choice.message;
      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length === 0 || step === maxSteps) {
        const reply = assistantContent(message);
        return {
          reply: reply || (toolCalls.length > 0
            ? "I hit the tool step limit before finishing. Ask again with a narrower question."
            : "No answer returned."),
          model: modelUsed,
          toolSteps,
        };
      }

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        if (toolSteps >= maxSteps) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: "Tool step limit reached." }),
          });
          continue;
        }
        toolSteps += 1;
        const name = call.function?.name ?? "";
        const parsedArgs = parseToolCallArguments(call.function?.arguments);
        let result: unknown;
        try {
          result = await awaitWithAgentDeadline(
            dispatch(name, parsedArgs, args.ctx),
            controller.signal,
          );
        } catch (err) {
          if (err instanceof ChatAgentTimeoutError) throw err;
          console.error("[chat tool]", name, err instanceof Error ? err.message : err);
          result = { ok: false, error: "Tool failed. Data is temporarily unavailable." };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return {
      reply: "I hit the tool step limit before finishing. Ask again with a narrower question.",
      model: modelUsed,
      toolSteps,
    };
  } finally {
    clearTimeout(timer);
  }
}
