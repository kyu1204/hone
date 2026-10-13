// The system under test: a tiny help-desk bot. It looks an answer up and words it the way a style text says.
import type { HoneConfig } from "../../src/index.ts"; // in your project: from "hone-eval"

const FACTS: Record<string, string> = {
  "what is the return window": "30 days",
  "how long does shipping take": "3 to 5 business days",
  "what is the support email": "help@example.com",
  "do you ship abroad": "yes",
  "what is the warranty period": "2 years",
  "which payment methods do you accept": "card and bank transfer",
  "where is my invoice": "in your account under Orders",
  "can i change my delivery address": "yes, until the parcel ships",
  "what are your opening hours": "9 to 18 on weekdays",
  "do you offer gift wrapping": "yes, for 3 euros",
  "is there a student discount": "10 percent with a valid ID",
  "how do i cancel my order": "from the order page, within one hour",
  "can i exchange an item": "yes, once per order",
  "how much is express delivery": "9 euros",
  "what is the support phone number": "+49 30 1234567",
  "where is my tracking number": "in the shipping confirmation email",
  "how long do refunds take": "5 business days",
  "how do i unsubscribe from the newsletter": "with the link at the bottom of any email",
};

export const STYLE = "Answer politely in a full sentence.";

// The toy reads its instructions the way a model would: a style that asks for the answer alone gets the answer alone.
function bot(style: string, loose: boolean) {
  const bare = /\b(only|just|bare|alone|nothing else|no (full |complete )?sentences?|without (a )?(full |complete )?sentences?)\b/i.test(style);
  const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return (input: unknown): string => {
    const question = clean(String(input));
    const hit = Object.entries(FACTS).find(([key]) => (loose ? question.includes(key) : question === key));
    if (!hit) return "Sorry, I do not know.";
    return bare ? hit[1] : `Thanks for asking! The answer is ${hit[1]}.`;
  };
}

/** The config with the bot in this style and matching mode. */
export const withBot = (c: HoneConfig, style: string, loose: boolean): HoneConfig => ({ ...c, targets: { bot: { kind: "fn", fn: bot(style, loose), style, loose, version: `${loose ? "loose" : "strict"}|${style}` } } });
