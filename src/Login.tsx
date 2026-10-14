import { useState } from "react"
import { ChevronLeft, ChevronRight, Delete, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { DEMO_PIN, USERS, login, type Role, type User } from "./auth"
import { LANGS, lang, setLang, t } from "./i18n"

export function Logo() {
  // Ordbild i DPJ:s grå logofärg. Byt mot DPJ:s riktiga SVG-logga inför en skarp demo.
  return (
    <div className="flex select-none items-baseline gap-1.5 text-logo" aria-label="DPJ Workspace">
      <span className="text-[26px] font-extrabold leading-none tracking-[-0.02em]">DPJ</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.28em]">Workspace</span>
    </div>
  )
}

// Rund avatar med initialer. Färgen följer namnet, så samma person alltid ser likadan ut.
const TONES = ["bg-sky-100 text-sky-900", "bg-emerald-100 text-emerald-900", "bg-amber-100 text-amber-900", "bg-violet-100 text-violet-900", "bg-rose-100 text-rose-900"]
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const tone = TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-bold", tone,
      size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm")}>{name.slice(0, 2).toUpperCase()}</span>
  )
}

export default function Login({ onLogin, only, title }: { onLogin: (u: User) => void; only?: Role; title?: string }) {
  const [who, setWho] = useState<User | null>(null)
  const [pin, setPin] = useState("")
  const [wrong, setWrong] = useState(false)
  const [tries, setTries] = useState(0)
  const users = only ? USERS.filter(u => u.role === only) : USERS

  const press = (d: string) => {
    if (!who) return
    const next = (pin + d).slice(0, 4)
    setPin(next); setWrong(false)
    if (next.length === 4) {
      const u = login(who.name, next)
      if (u) onLogin(u)
      else { setWrong(true); setTries(t => t + 1); setPin(""); try { navigator.vibrate?.([120, 60, 120]) } catch { /* ok */ } }
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col px-4 pb-6 pt-10">
        <Logo />
        <div className="mt-8 rounded-2xl border bg-card p-5 shadow-sm">
          {who && <div className="mb-3 flex justify-center"><Avatar name={who.name} size="lg" /></div>}
          <h1 className={cn("text-2xl font-extrabold tracking-tight", who && "text-center")}>{who ? t("login.hi", { name: who.name }) : title ?? t("login.title")}</h1>
          <p className={cn("mt-1 text-muted-foreground", who && "text-center")}>{who ? t("login.pin") : t("login.who")}</p>

          {!who ? (
            <div className="mt-5 grid gap-2">
              {users.map(u => (
                <button key={u.name} onClick={() => setWho(u)}
                  className="rise flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-muted/40 active:scale-[0.99]">
                  <Avatar name={u.name} />
                  <span className="flex-1">
                    <span className="block text-[17px] font-semibold leading-tight">{u.name}</span>
                    <span className="block text-[13px] text-muted-foreground">{t(`role.${u.role}`)}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground rtl:rotate-180" />
                </button>
              ))}
            </div>
          ) : (
            <>
              <div key={tries} className={cn("mt-5 flex justify-center gap-3", wrong && "shake")} aria-label={t("login.digits", { n: pin.length })}>
                {[0, 1, 2, 3].map(k => <span key={k} className={cn("h-3.5 w-3.5 rounded-full border-2 border-primary transition-colors", k < pin.length && "bg-primary")} />)}
              </div>
              <p className={cn("mt-2 h-5 text-center text-sm", wrong ? "text-destructive" : "text-muted-foreground")}>{wrong ? t("login.wrong") : ""}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => (
                  <Button key={d} variant="outline" className="h-16 rounded-xl text-2xl font-bold shadow-sm" onClick={() => press(d)}>{d}</Button>
                ))}
                <Button variant="ghost" className="h-16 rounded-xl" aria-label={t("login.switch")} onClick={() => { setWho(null); setPin(""); setWrong(false) }}><ChevronLeft className="!h-6 !w-6 rtl:rotate-180" /></Button>
                <Button variant="outline" className="h-16 rounded-xl text-2xl font-bold shadow-sm" onClick={() => press("0")}>0</Button>
                <Button variant="ghost" className="h-16 rounded-xl" aria-label={t("common.erase")} onClick={() => setPin(pin.slice(0, -1))}><Delete className="!h-6 !w-6" /></Button>
              </div>
            </>
          )}
        </div>

        <p className="mt-auto flex items-start gap-2 pt-6 text-[13px] text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("login.demo", { pin: DEMO_PIN })}
        </p>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label={t("common.language")}>
          {LANGS.map(l => (
            <button key={l.code} onClick={() => l.code !== lang && setLang(l.code)} aria-pressed={l.code === lang}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold",
                l.code === lang ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>{l.name}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
