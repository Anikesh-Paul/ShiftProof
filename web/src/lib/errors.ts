import { AppwriteException } from "appwrite";

/** Surface Appwrite error.message; do not invent alternate error shapes. */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof AppwriteException) {
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof AppwriteException && err.code === 401;
}
