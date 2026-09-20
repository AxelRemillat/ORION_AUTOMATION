/**
 * Point d'entree unique du design system Ciel & Lagon.
 * Les ecrans importent d'ici : `import { Button, Card } from "@/components/ui"`.
 * Voir CONTRACT.md pour les tokens de couleur et l'API detaillee.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./button";
export { Input, Label, fieldClassName, type InputProps } from "./input";
export { Textarea } from "./textarea";
export { Select } from "./select";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  StatCard,
} from "./card";
export { Badge, ProspectStatusBadge, DealStatusBadge, type BadgeTone } from "./badge";
export { Table, THead, TBody, TR, TH, TD, TableEmpty } from "./table";
export { Modal, type ModalProps } from "./modal";
export { ToastProvider, useToast } from "./toast";
export { ThemeToggle } from "./theme-toggle";
export { Skeleton } from "./skeleton";
export { EmptyState } from "./empty-state";
export { PageHeader } from "./page-header";
export { Logo, type LogoSize } from "./logo";
