import { Badge } from "./ui";

/** A short marker for generated simulated records; the full note shows on hover and inside the record. */
export default function SimulatedTag({ note }: { note: string }) {
  return (
    <span title={note} className="cursor-help">
      <Badge kind="assumption">SIMULATED</Badge>
    </span>
  );
}
