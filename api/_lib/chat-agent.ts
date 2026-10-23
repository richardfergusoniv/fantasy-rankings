/**
 * Tool-calling agent loop over OpenRouter chat completions.
 */
import { CHAT_MAX_TOOL_STEPS } from "./chat-config.js";
import {
  buildInitialMessages,
  callOpenRouterWithFallback,
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
  fetchImpl?: OpenRouterFetch;
  maxToolSteps?: number;
  primaryModel?: string;
  fallbackModel?: string;
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

export async function runChatAgent(args: RunChatAgentArgs): Promise<RunChatAgentResult> {
  const maxSteps = args.maxToolSteps ?? CHAT_MAX_TOOL_STEPS;
  const dispatch = args.dispatchTool ?? dispatchChatTool;
  const messages = buildInitialMessages(args.history ?? [], args.userMessage);
  let modelUsed = "";
  let toolSteps = 0;

  for (let step = 0; step <= maxSteps; step += 1) {
    const { response, model } = await callOpenRouterWithFallback({
      apiKey: args.apiKey,
      messages,
      tools: CHAT_TOOL_DEFINITIONS,
      fetchImpl: args.fetchImpl,
      primaryModel: args.primaryModel,
      fallbackModel: args.fallbackModel,
    });
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
      if (toolSteps >= maxSteps) break;
      toolSteps += 1;
      const name = call.function?.name ?? "";
      const parsedArgs = parseToolCallArguments(call.function?.arguments);
      const result = await dispatch(name, parsedArgs, args.ctx);
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
}
