import { z } from "zod";

// Schemas stay small and flat: structured outputs compile each one into a
// grammar, and a large nested schema is rejected with "compiled grammar is too
// large". Nullable fields are plain strings where "" means none.

// A resume line that still depends on an unanswered question carries the
// marker [[needs:<question-id>]]. The PDF drops such lines.
export const NEEDS = /\[\[needs:([a-z0-9-]+)\]\]/;
const line = "A finished resume line. If it depends on a fact the candidate has not given, end it with [[needs:<question-id>]].";

export const ResumeDoc = z.object({
  headline: z.string().describe("The role title shown under the name, e.g. \"Backend Engineer\": the posting's title, trimmed of seniority or team the candidate's experience does not support. No company name."),
  summary: z.array(z.string().describe(line)),
  order: z.array(z.enum(["education", "experience", "projects", "skills"])),
  education: z.array(z.object({ school: z.string(), location: z.string(), degree: z.string(), dates: z.string(), details: z.array(z.string()) })),
  experience: z.array(
    z.object({ title: z.string(), company: z.string(), url: z.string(), location: z.string(), dates: z.string(), bullets: z.array(z.string().describe(line)) }),
  ),
  projects: z.array(z.object({ name: z.string(), stack: z.string(), url: z.string(), bullets: z.array(z.string().describe(line)) })),
  skills: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
});
export type ResumeDoc = z.infer<typeof ResumeDoc>;

// The knowledge-base items worth adding to a CV for one posting, best first.
export const CvPicks = z.object({
  picks: z.array(
    z.object({
      id: z.string().describe("The item's exact id from the list."),
      relevance: z.enum(["high", "medium", "low"]),
      reason: z.string().describe("One short line: what in the posting this item answers."),
    }),
  ),
});
export type CvPicks = z.infer<typeof CvPicks>;

export interface CvOption {
  id: string;
  type: "repo" | "page";
  title: string;
  url: string;
  summary: string;
  relevance: CvPicks["picks"][number]["relevance"];
  reason: string;
}

export const Question = z.object({ id: z.string(), question: z.string(), why: z.string() });
export type Question = z.infer<typeof Question>;

export const Rebuild = z.object({ resume: ResumeDoc, questions: z.array(Question) });
export type Rebuild = z.infer<typeof Rebuild>;

// One turn of the project interview: a question, or a proposal for the project.
export const ProjectTurn = z.object({
  message: z.string().describe("Your next question, or, when ready, one or two sentences on what changed."),
  facts: z.array(z.string()).describe("New facts the candidate stated in their latest message, each a short standalone sentence naming the project. Empty when none."),
  ready: z.boolean().describe("True when this turn carries the proposal."),
  name: z.string(),
  stack: z.string(),
  url: z.string(),
  bullets: z.array(z.string()),
  keywords: z.array(z.object({ keyword: z.string(), basis: z.enum(["reworded", "confirmed"]) })),
});
export type ProjectTurn = z.infer<typeof ProjectTurn>;

export const Findings = z.object({
  company: z.string(),
  role: z.string(),
  jobId: z.string().describe("The posting's official job id, or an empty string."),
  mistakes: z.array(z.object({ quote: z.string(), why: z.string(), flaggedBy: z.string() })),
});
export type Findings = z.infer<typeof Findings>;

export const ProjectIdea = z.object({
  title: z.string(),
  extends: z.string().describe("Full name of the candidate's existing repo this builds on, or an empty string for a new repo."),
  closesGap: z.string(),
  companyAngle: z.string().describe("How it mirrors this company's product, customers or stack. Empty when not company-specific."),
  pitch: z.string(),
  stack: z.array(z.string()),
  keywords: z.array(z.string()),
  scope: z.string(),
  steps: z.array(z.string()),
  bulletOnceBuilt: z.string(),
});
export type ProjectIdea = z.infer<typeof ProjectIdea>;

export const Ideas = z.object({ ideas: z.array(ProjectIdea) });

export const Email = z.object({ subject: z.string(), body: z.string() });
export type Email = z.infer<typeof Email>;

// What the app shows for a finished run.
export interface Synthesis {
  job: { company: string; role: string; jobId: string };
  mistakes: Findings["mistakes"];
  resume: ResumeDoc;
  questions: Question[];
  projects: ProjectIdea[];
}

export const OUTREACH_CHANNELS = ["linkedin-connect", "linkedin-message", "email"] as const;

export const Sequence = z.object({
  steps: z.array(
    z.object({
      day: z.number().describe("Days after the first touch, starting at 0."),
      channel: z.enum(OUTREACH_CHANNELS),
      recipient: z.string().describe("Name and role, e.g. 'Ankit Jain, founder'."),
      subject: z.string().describe("Email subject; empty for LinkedIn."),
      body: z.string(),
      sendIf: z.string().describe("When to send, e.g. 'always', 'if the connection is accepted', 'if no reply to the day-0 email'."),
    }),
  ),
});
export type Sequence = z.infer<typeof Sequence>;

// LinkedIn's limits: free accounts get 200 characters in a connection note.
export const LIMITS = { "linkedin-connect": 200, "linkedin-message": 600, emailWords: 130 } as const;

// What a candidate needs to know about a posting at a glance.
export const JobDetails = z.object({
  company: z.string(),
  role: z.string(),
  location: z.string().describe("City and country, plus remote / hybrid / onsite. Empty if not stated."),
  salary: z.string().describe("As stated, e.g. 'USD 130,000 - 170,000 per year'. Empty if not stated."),
  experience: z.string().describe("Years or level asked for, e.g. '1-3 years'. Empty if not stated."),
  mustHave: z.array(z.string()).describe("Hard requirements, each a few words."),
  niceToHave: z.array(z.string()),
  stack: z.array(z.string()).describe("Languages, frameworks and tools named in the posting."),
  howToApply: z.string().describe("The application route: a URL, an email address with instructions, or 'apply on the page'."),
  applyEmail: z.string().describe("Email address to apply to, if the posting gives one; otherwise empty."),
  emailAsk: z.string().describe("If the posting asks applicants to send an email or cover note, what it must contain. Empty otherwise."),
  formQuestions: z.array(z.string()).describe("Application questions the posting lists, verbatim. Empty if none."),
  redFlags: z.array(z.string()).describe("Things that may not fit a candidate in India, e.g. US work authorization or onsite-only abroad."),
});
export type JobDetails = z.infer<typeof JobDetails>;

export const STAGES = ["To apply", "Applied", "In conversation", "Interviewing", "Offer", "Closed"] as const;
export type Stage = (typeof STAGES)[number];

// The write-ups a job usually needs, in the order they are sent.
export const WRITEUPS = ["application-email", "outreach", "referral", "form-answers", "follow-up", "thank-you"] as const;
export type Writeup = (typeof WRITEUPS)[number];

export interface Board {
  stage: Stage;
  movedAt: string;
  notes: string;
  sent: Partial<Record<Writeup, string>>; // date each write-up was sent
}
