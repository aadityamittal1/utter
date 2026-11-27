import { Toast } from "@heroui/react";

/** Mount once per window that shows toasts. Fire them with `toast` from lib/store. */
export function ToastHost() {
  return <Toast.Provider placement="bottom end" />;
}
