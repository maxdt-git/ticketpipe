// Send the reviewed ticket to GitHub Issues (or save it locally in dry-run mode).
// To support another tracker (Jira, Linear, ServiceNow...), add a function with the same signature.

import { mkdir } from "node:fs/promises";
import { config } from "./config";

export type IssueInput = { title: string; body: string; labels?: string[] };
export type PublishResult = { url: string; number?: number; dryRun: boolean };

export async function publishIssue(issue: IssueInput): Promise<PublishResult> {
  if (!config.githubToken || !/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo)) {
    return saveLocally(issue);
  }

  const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "content-type": "application/json",
      "User-Agent": "screenpipe-ticket-agent",
    },
    body: JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels ?? [] }),
  });
  if (!res.ok) throw new Error(`GitHub API → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as { html_url: string; number: number };
  return { url: json.html_url, number: json.number, dryRun: false };
}

async function saveLocally(issue: IssueInput): Promise<PublishResult> {
  await mkdir("out", { recursive: true });
  const path = `out/ticket-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  const labels = issue.labels?.length ? `Labels: ${issue.labels.join(", ")}\n\n` : "";
  await Bun.write(path, `# ${issue.title}\n\n${labels}${issue.body}`);
  return { url: path, dryRun: true };
}
