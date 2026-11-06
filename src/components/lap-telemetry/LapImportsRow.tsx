import { FileUp, X } from "lucide-react";
import { useLapImports } from "../../context/LapImportsContext";
import type { LapImport } from "../../context/lapImports";
import { recordingLabel } from "./labels";

function ownerLabel(entry: LapImport): string {
  if (!entry.owner) return "Whose laps?";
  return entry.owner.name === null ? "Yours" : entry.owner.name || "Friend";
}

/**
 * The files imported at this circuit, each reopening "whose laps" or removed
 * from the browser; without any, how to bring a friend's laps in.
 */
export function LapImportsRow({ slugs }: { slugs: ReadonlySet<string> }) {
  const { imports, askOwner, remove } = useLapImports();
  const here = imports.filter((entry) => slugs.has(entry.slug));

  if (here.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-tone-600">
        <FileUp className="size-3.5 shrink-0" />
        Got a lap file from a friend? Drop their .pngt anywhere to compare.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-tone-600">Imported</span>
      {here.map((entry) => (
        <span
          key={entry.slug}
          className="inline-flex items-center rounded-md bg-tone-800/60"
        >
          <button
            type="button"
            onClick={() => askOwner(entry.slug)}
            title={`${entry.fileName}: change whose laps these are`}
            className="rounded-l-md py-1 pl-2 pr-1.5 text-left transition-colors hover:bg-tone-700/50"
          >
            <span className="text-tone-200">{ownerLabel(entry)}</span>{" "}
            <span className="text-tone-500">{recordingLabel(entry.raw)}</span>
          </button>
          <button
            type="button"
            onClick={() => remove(entry.slug)}
            aria-label={`Remove ${entry.fileName}`}
            title="Remove from this browser"
            className="rounded-r-md px-1.5 py-1 text-tone-500 transition-colors hover:bg-tone-700/50 hover:text-tone-200"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
