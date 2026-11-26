// Sign-in is switched on only after the database patch is in place and the accounts exist.
// Both values are read at build time and are visible in the shipped app. The demo password keeps
// each account's chat history apart; it is NOT a secret and protects nothing from someone who has the link.
export const AUTH_ON = process.env.NEXT_PUBLIC_AUTH_MODE === "on";
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";
