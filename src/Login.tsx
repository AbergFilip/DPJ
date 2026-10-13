import { useState } from "react"
import { ChevronLeft, Delete, Lock } from "lucide-react"
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
    <div className="mx-auto flex min-h-screen max-w-sm flex-col px-4 py-8">
      <Logo />
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">{who ? t("login.hi", { name: who.name }) : title ?? t("login.title")}</h1>
      <p className="mt-1 text-muted-foreground">{who ? t("login.pin") : t("login.who")}</p>

      {!who ? (
        <div className="mt-6 grid gap-2">
          {users.map(u => (
            <button key={u.name} onClick={() => setWho(u)}
              className="flex h-14 items-center justify-between rounded-md border bg-card px-4 text-left text-lg font-semibold">
              {u.name}
              <span className={cn("rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
                u.role === "ledare" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>{t(`role.${u.role}`)}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div key={tries} className={cn("mt-6 flex justify-center gap-3", wrong && "shake")} aria-label={t("login.digits", { n: pin.length })}>
            {[0, 1, 2, 3].map(k => <span key={k} className={cn("h-4 w-4 rounded-full border-2 border-primary", k < pin.length && "bg-primary")} />)}
          </div>
          <p className={cn("mt-2 h-5 text-center text-sm", wrong ? "text-destructive" : "text-muted-foreground")}>{wrong ? t("login.wrong") : ""}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => (
              <Button key={d} variant="outline" className="h-16 text-2xl font-bold" onClick={() => press(d)}>{d}</Button>
            ))}
            <Button variant="ghost" className="h-16" aria-label={t("login.switch")} onClick={() => { setWho(null); setPin(""); setWrong(false) }}><ChevronLeft className="!h-6 !w-6" /></Button>
            <Button variant="outline" className="h-16 text-2xl font-bold" onClick={() => press("0")}>0</Button>
            <Button variant="ghost" className="h-16" aria-label={t("common.erase")} onClick={() => setPin(pin.slice(0, -1))}><Delete className="!h-6 !w-6" /></Button>
          </div>
        </>
      )}

      <p className="mt-auto flex items-start gap-2 rounded-md bg-muted px-3 py-2 pt-2 text-[13px] text-muted-foreground">
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
  )
}
