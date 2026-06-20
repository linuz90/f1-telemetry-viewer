import { REPO_URL } from "../constants/links";

export function pullRequestUrl(number: number | string): string {
  return `${REPO_URL}/pull/${number}`;
}
