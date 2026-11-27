// A rough size of the database once a dataset is loaded. Calibrated on one measurement: about 30 MB
// with the original data (27 Nov). It is an estimate; the load command also prints the real size.
// Relative imports only: the load command runs this file outside the app.
import { BET_TABLE_NAMES } from "./bet-spec";

/** the database before any festival data */
export const BASE_MB = 11;
/** per row and per copy, with indexes. Attendee rows repeat the person, campaign and owner names. */
const ATTENDEE_ROW_BYTES = 330;
const OTHER_ROW_BYTES = 200;
/** each dataset is kept twice: as loaded (for reset) and as edited */
const COPIES = 2;

const MB = 1024 * 1024;
const isBetTable = (name: string) => (BET_TABLE_NAMES as string[]).includes(name);

export interface SizeEstimate {
  rows: number;
  /** what this dataset takes, both copies */
  datasetMb: number;
  /** extra space held while a reload or reset has not finished: the edited copy exists twice */
  switchExtraMb: number;
}

/** counts are keyed original_<table>, as the checks return them */
export function estimateSize(counts: Record<string, number>): SizeEstimate {
  let rows = 0;
  let bytes = 0;
  for (const [key, n] of Object.entries(counts)) {
    rows += n;
    bytes += n * (isBetTable(key.replace(/^original_/, "")) ? OTHER_ROW_BYTES : ATTENDEE_ROW_BYTES);
  }
  return { rows, datasetMb: (bytes * COPIES) / MB, switchExtraMb: bytes / MB };
}
