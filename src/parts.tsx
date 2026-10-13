// Delar som används av flera vyer i plockappen.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { Camera, Keyboard, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProductType } from "./data"

// Kameraskannern (zxing) är stor, så den laddas först när någon trycker på kameraknappen.
const CameraScanner = lazy(() => import("./CameraScanner"))

const ICON: Record<ProductType, string> = {
  skiva: '<path d="M4 22 L30 14 L44 20 L18 28 Z"/><path d="M4 22 v4 L18 32 v-4 M18 32 L44 24 v-4"/>',
  stativ: '<path d="M8 12 H40 M14 12 V36 M34 12 V36 M8 36 H20 M28 36 H40"/>',
  hurts: '<rect x="12" y="6" width="24" height="34" rx="2"/><path d="M12 17 H36 M12 28 H36 M21 11.5 h6 M21 22.5 h6 M21 33.5 h6"/>',
  stol: '<path d="M16 6 h16 v16 H16 Z M12 26 H36 M24 26 V36 M14 42 L24 36 L34 42"/>',
  vagg: '<rect x="6" y="10" width="36" height="20" rx="3"/><path d="M14 30 v8 M34 30 v8 M10 38 h8 M30 38 h8"/>',
  arm: '<rect x="4" y="8" width="16" height="11" rx="1"/><rect x="28" y="8" width="16" height="11" rx="1"/><path d="M12 19 L24 26 L36 19 M24 26 V42 M18 42 H30"/>',
  ranna: '<path d="M4 18 L4 28 L44 28 L44 18 M4 28 L10 32 L44 32 L44 28"/>',
  fot: '<path d="M6 32 L40 22 L42 28 L8 38 Z M14 36 v4 M34 26 v8"/>',
}
export const Pict = ({ type, className }: { type: ProductType; className?: string }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
    className={className} dangerouslySetInnerHTML={{ __html: ICON[type] ?? "" }} aria-hidden="true" />
)

export function Header({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b bg-header">
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">{children}</div>
    </header>
  )
}

export function Chip({ children, bad, onClick }: { children: ReactNode; bad?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 text-sm font-semibold",
      bad ? "border-destructive text-destructive" : "text-card-foreground")}>{children}</button>
  )
}

// Skannerfält: tar emot handskanner (som skriver koden och Enter), kamera eller inskriven kod.
export function ScanBar({ placeholder, hint, onScan, onNoCamera, focusKey }: {
  placeholder: string; hint: string; onScan: (code: string) => void; onNoCamera: () => void; focusKey?: unknown
}) {
  const [code, setCode] = useState("")
  const [typing, setTyping] = useState(false)
  const [camera, setCamera] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!camera) inputRef.current?.focus({ preventScroll: true }) }, [focusKey, camera])
  return (
    <>
      <form className="mt-3 flex gap-2" autoComplete="off" onSubmit={e => { e.preventDefault(); onScan(code); setCode("") }}>
        <div className="relative min-w-0 flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input ref={inputRef} id="scan" value={code} onChange={e => setCode(e.target.value)} inputMode={typing ? "text" : "none"}
            placeholder={placeholder} aria-label="Skannad kod"
            className="h-12 w-full rounded-md border-2 border-dashed border-input bg-card pl-10 pr-3 font-mono text-base text-card-foreground outline-none focus:border-solid focus:border-ring" />
        </div>
        {!!navigator.mediaDevices?.getUserMedia && (
          <Button type="button" className="h-12 px-4" onClick={() => setCamera(true)} aria-label="Skanna med kameran"><Camera className="!h-5 !w-5" /></Button>
        )}
        <Button type="button" variant="outline" className="h-12" aria-label="Skriv in kod" onClick={() => { setTyping(true); setTimeout(() => inputRef.current?.focus(), 0) }}><Keyboard className="!h-5 !w-5" /></Button>
      </form>
      {camera && <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black" />}><CameraScanner onClose={() => setCamera(false)} onFail={() => { setCamera(false); onNoCamera() }}
        onCode={c => { setCamera(false); onScan(c) }} hint={hint} /></Suspense>}
    </>
  )
}
