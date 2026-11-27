// The two datasets the app can show. The original one uses the tables and database functions as they
// have always been named; the simulated one has the same names with a prefix
// (supabase/patch_session4_datasets.sql). This file is the only place that knows the prefix.
// Relative imports only: the load command runs this file outside the app.

export type DatasetId = "original" | "simulated";

export const DATASET_IDS: DatasetId[] = ["original", "simulated"];

export const DATASET_LABEL: Record<DatasetId, string> = {
  original: "Original 2025 data",
  simulated: "Simulated run with our bets",
};

export const DATASET_SHORT: Record<DatasetId, string> = {
  original: "Original 2025",
  simulated: "Simulated run",
};

/** the first line of every copilot answer */
export const ANSWER_LABEL: Record<DatasetId, string> = {
  original: "Original 2025 data",
  simulated: "SIMULATED run with our bets (made up, not real results)",
};

const PREFIX = "sim_";

/** the database table that holds `table` for this dataset */
export const tableName = (dataset: DatasetId, table: string) => (dataset === "simulated" ? PREFIX + table : table);

/** the database function that does `fn` for this dataset */
export const rpcName = (dataset: DatasetId, fn: string) => (dataset === "simulated" ? PREFIX + fn : fn);

/** the loader's staging table, for example original_people or sim_original_people */
export const stagingName = (dataset: DatasetId, table: string) => tableName(dataset, `original_${table}`);

export const isDatasetId = (v: unknown): v is DatasetId => v === "original" || v === "simulated";

/** a database that has not had the patch answers like this; any other error is a real failure */
export const isMissingInDatabase = (message: string) => /could not find the (function|table)|does not exist|schema cache/i.test(message);
