import { timingSafeEqual } from "node:crypto";
export function validOAuthState(expected: string | undefined, received: string | null) { if (!expected || !received) return false; const left = Buffer.from(expected); const right = Buffer.from(received); return left.length === right.length && timingSafeEqual(left, right); }
