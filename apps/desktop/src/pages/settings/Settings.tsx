import { Settings as SettingsIcon } from "lucide-react";
import { PlaceholderPage } from "../../components/PlaceholderPage";

/** Placeholder: replaced by the settings task (Shortcuts, Microphone, Models, AI, General, Privacy, About). */
export default function Settings() {
  return <PlaceholderPage title="Settings" description="Shortcuts, microphone, models and privacy." icon={<SettingsIcon size={18} />} />;
}
