declare module "virtual:changelog" {
  interface ChangelogEntry {
    hash: string;
    date: string;
    type: string;
    message: string;
    pr?: number;
  }
  const entries: ChangelogEntry[];
  export default entries;
}
