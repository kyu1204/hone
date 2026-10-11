// OpenTelemetry GenAI semantic convention names used by hone, in one place.
// Source: github.com/open-telemetry/semantic-conventions-genai commit 6fd0d763a092db245a54104fc1124031eb3c51d2 (Development status, read 2026-10-12).
export const SEMCONV_COMMIT = "6fd0d763a092db245a54104fc1124031eb3c51d2";

export const ATTR = {
  operationName: "gen_ai.operation.name",
  providerName: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  finishReasons: "gen_ai.response.finish_reasons",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  inputMessages: "gen_ai.input.messages",
  outputMessages: "gen_ai.output.messages",
  toolName: "gen_ai.tool.name",
  toolCallId: "gen_ai.tool.call.id",
  toolType: "gen_ai.tool.type",
  toolDescription: "gen_ai.tool.description",
  toolArguments: "gen_ai.tool.call.arguments",
  toolResult: "gen_ai.tool.call.result",
  dataSourceId: "gen_ai.data_source.id",
  retrievalQuery: "gen_ai.retrieval.query.text",
  retrievalTopK: "gen_ai.retrieval.top_k",
  retrievalDocuments: "gen_ai.retrieval.documents",
  agentName: "gen_ai.agent.name",
  agentId: "gen_ai.agent.id",
  agentVersion: "gen_ai.agent.version",
  conversationId: "gen_ai.conversation.id",
  evaluationName: "gen_ai.evaluation.name",
  evaluationScoreValue: "gen_ai.evaluation.score.value",
  evaluationScoreLabel: "gen_ai.evaluation.score.label",
  evaluationExplanation: "gen_ai.evaluation.explanation",
  errorType: "error.type",
} as const;

export const EVENT_EVALUATION_RESULT = "gen_ai.evaluation.result";

/** hone span kind -> gen_ai.operation.name (export) and the inverse (import). */
export const OPERATION_BY_KIND = { llm: "chat", tool: "execute_tool", retrieval: "retrieval", agent: "invoke_agent", custom: "custom" } as const;
export const KIND_BY_OPERATION: Record<string, "llm" | "tool" | "retrieval" | "agent"> = { chat: "llm", generate_content: "llm", text_completion: "llm", execute_tool: "tool", retrieval: "retrieval", invoke_agent: "agent" };
