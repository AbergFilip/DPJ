import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser"
import { Button } from "@/components/ui/button"
import { t } from "./i18n"

/* ---------- Kameraskanning (zxing, fungerar i Safari på iPhone och Chrome på Android) ---------- */

export default function CameraScanner({ onCode, onClose, onFail, hint }: { onCode: (c: string) => void; onClose: () => void; onFail: () => void; hint: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let controls: IScannerControls | undefined
    let stopped = false
    const reader = new BrowserMultiFormatReader()
    reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current!, (result, _err, ctl) => {
      if (result && !stopped) { stopped = true; ctl.stop(); onCode(result.getText()) }
    }).then(c => { controls = c; if (stopped) c.stop() }).catch(() => { if (!stopped) onFail() })
    return () => { stopped = true; controls?.stop() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      <video ref={videoRef} playsInline muted className="min-h-0 w-full flex-1 object-cover" />
      <div className="pointer-events-none absolute inset-x-[10%] top-[36%] h-[22%] rounded-xl border-[3px] border-[hsl(var(--sign-accent))]" />
      <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+16px)] text-center text-lg font-bold text-white drop-shadow">{hint}</div>
      <div className="flex justify-center bg-black p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <Button variant="secondary" className="h-12 px-6 text-base font-bold" onClick={onClose}><X />{t("scan.close")}</Button>
      </div>
    </div>
  )
}
