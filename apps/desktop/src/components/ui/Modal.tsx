import type { ReactNode } from "react";
import { Modal as HeroModal } from "@heroui/react";
import { cn } from "../../lib/cn";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "xs" | "sm" | "md" | "lg" | "cover" | "full";
  /** Extra classes for the dialog surface (e.g. a wider max width). */
  className?: string;
}

/** Controlled HeroUI dialog: focus trap, Esc, backdrop click and focus return come from React Aria. */
export function Modal({ isOpen, onClose, title, children, footer, size = "md", className }: ModalProps) {
  return (
    <HeroModal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <HeroModal.Container size={size}>
        <HeroModal.Dialog className={cn("rounded-card", className)}>
          <HeroModal.CloseTrigger />
          <HeroModal.Header>
            <HeroModal.Heading className="text-subtitle text-ink">{title}</HeroModal.Heading>
          </HeroModal.Header>
          <HeroModal.Body>{children}</HeroModal.Body>
          {footer && <HeroModal.Footer>{footer}</HeroModal.Footer>}
        </HeroModal.Dialog>
      </HeroModal.Container>
    </HeroModal.Backdrop>
  );
}
