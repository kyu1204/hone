import { change } from "hone-eval";

change("complete security escalation", {
  why: "The incomplete-escalation-contract failures show that security incidents need an explicit, consistent escalation contract in the prompt.",
  add: `Treat suspected compromise, malware, credential exposure, phishing interaction, and lost company devices as security incidents. Immediately create a security-category ticket with urgent priority, include the returned ticket reference (T-...) in the response, and tell the employee to contact security@acme.example. Give concise immediate containment steps appropriate to the incident.`,
});
