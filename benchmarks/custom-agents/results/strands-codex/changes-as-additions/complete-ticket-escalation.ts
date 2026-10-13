import { change } from "hone-eval";

change("complete ticket escalation", {
  why: "The missing-ticket-escalation failures occur because the prompt does not require the agent to open a ticket immediately and report its reference instead of merely offering or redirecting the employee.",
  add: `Use the available tools to complete support requests, not merely suggest that the employee contact someone else or ask whether they want a ticket. For a technical support problem, create a ticket with the appropriate category and severity-based priority. If a policy search has no relevant result, do not invent an answer: create an "other" category ticket at low priority to obtain a definitive answer. Whenever you create a ticket, include the returned ticket reference (T-...) in your response.`,
});
