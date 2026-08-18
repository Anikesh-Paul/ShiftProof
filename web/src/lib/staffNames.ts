/**
 * Staff display labels for manager UI.
 * Client SDK cannot list other users — resolve via known demo IDs + session cache
 * (staff login remembers their name for later manager views on the same browser).
 */

const STORAGE_KEY = "sp_staff_names_v1";

/** Seed / demo account product labels (SEED.md user IDs). */
const KNOWN: Record<string, string> = {
  demo_staff: "Priya · Opening",
  demo_staff_2: "Arjun · Opening",
  demo_manager: "Demo Manager",
};

const memory = new Map<string, string>();
let storageHydrated = false;

function hydrateFromStorage() {
  if (storageHydrated || typeof localStorage === "undefined") return;
  storageHydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [id, label] of Object.entries(parsed)) {
      if (id && label) memory.set(id, label);
    }
  } catch {
    /* ignore corrupt cache */
  }
}

function persist(userId: string, label: string) {
  if (typeof localStorage === "undefined") return;
  try {
    hydrateFromStorage();
    const all: Record<string, string> = {};
    for (const [id, name] of memory.entries()) all[id] = name;
    all[userId] = label;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

/** Turn Appwrite user.name into a calm product label. */
export function formatStaffDisplayName(name: string | undefined | null): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  // "Demo Staff" → keep readable; avoid bare role alone
  if (/^staff$/i.test(raw)) return "Opening staff";
  if (/^demo\s*staff$/i.test(raw)) return "Priya · Opening";
  return raw;
}

/** Call on login / session restore so manager inbox can resolve this user later. */
export function rememberStaffName(
  userId: string,
  name: string | undefined | null,
): void {
  if (!userId) return;
  const label = formatStaffDisplayName(name);
  if (!label) return;
  // Prefer fixed product labels for seed accounts
  const finalLabel = KNOWN[userId] ?? label;
  memory.set(userId, finalLabel);
  persist(userId, finalLabel);
}

/** Manager-facing name — drop the seed role suffix. */
export function displayStaffName(label: string): string {
  return label.replace(/\s*·\s*Opening\s*$/i, "").trim() || label;
}

/** Resolve createdBy → label for inbox / scoreboard. */
export function resolveStaffLabel(createdBy: string): string {
  if (!createdBy) return "Opening staff";
  if (KNOWN[createdBy]) return KNOWN[createdBy];

  hydrateFromStorage();
  const cached = memory.get(createdBy);
  if (cached) return cached;

  if (createdBy.startsWith("demo_")) {
    return createdBy.replace(/^demo_/, "").replace(/_/g, " ") || "Opening staff";
  }
  if (/^staff$/i.test(createdBy)) return "Opening staff";

  // Appwrite-style ids — don't dump raw hex in the UI
  if (createdBy.length > 12 || /^[0-9a-f]{16,}$/i.test(createdBy)) {
    return "Opening staff";
  }

  return createdBy;
}
