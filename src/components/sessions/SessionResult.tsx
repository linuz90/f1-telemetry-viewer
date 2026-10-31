import { cn } from "../../utils/cn";
import type { SessionResultText } from "./sessionFormat";

/** "P7 from P2": the position in bold, its context tinted by what it means. */
export function SessionResult({ result }: { result: SessionResultText }) {
  return (
    <>
      <b
        className={cn(
          "font-semibold text-tone-50",
          result.tone === "best" && "text-best",
        )}
      >
        {result.main}
      </b>
      {result.detail && (
        <>
          {" "}
          <span
            className={cn(
              "text-xs",
              result.tone === "gain"
                ? "text-ahead"
                : result.tone === "loss"
                  ? "text-behind"
                  : "text-tone-500",
            )}
          >
            {result.detail}
          </span>
        </>
      )}
    </>
  );
}
