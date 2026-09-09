"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  /** Affiche une notification (4 s par defaut). */
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Acces aux notifications. Requiert <ToastProvider> plus haut dans l'arbre. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast doit etre utilise dans un <ToastProvider>.");
  return context;
}

const TONES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-good" },
  error: { icon: AlertTriangle, className: "text-lost" },
  info: { icon: Info, className: "text-primary" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const toast = (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), 4000);
    };
    return {
      toast,
      success: (message: string) => toast(message, "success"),
      error: (message: string) => toast(message, "error"),
    };
  }, [dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map(({ id, tone, message }) => {
          const { icon: Icon, className } = TONES[tone];
          return (
            <div
              key={id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-elev p-3 shadow-overlay animate-slide-up"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} aria-hidden />
              <p className="flex-1 text-[13px] leading-snug text-text">{message}</p>
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="Fermer la notification"
                className="rounded p-0.5 text-faint transition-colors hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
