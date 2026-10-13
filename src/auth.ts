// Simulerad inloggning för demon. Namn och PIN kontrolleras bara i webbläsaren, inte mot någon server.
// Inför riktig drift ersätts detta med Supabase Auth och funktionerna i databasen läser användaren därifrån.

export type Role = "plock" | "ledare"
export interface User { name: string; role: Role }

export const DEMO_PIN = "1234"
export const USERS: User[] = [
  { name: "Sara", role: "plock" },
  { name: "Amir", role: "plock" },
  { name: "Jonna", role: "plock" },
  { name: "Mikael", role: "plock" },
  { name: "Lena", role: "ledare" },
]
export const ROLE_LABEL: Record<Role, string> = { plock: "Plockare", ledare: "Arbetsledare" }

const KEY = "dpj-plock-session"

export function currentUser(): User | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null")
    return USERS.find(u => u.name === s?.name) ?? null
  } catch { return null }
}

export function login(name: string, pin: string): User | null {
  const u = USERS.find(x => x.name === name)
  if (!u || pin !== DEMO_PIN) return null
  try { localStorage.setItem(KEY, JSON.stringify({ name: u.name, at: Date.now() })) } catch { /* privat läge */ }
  return u
}

export function logout() {
  try { localStorage.removeItem(KEY) } catch { /* ok */ }
}
