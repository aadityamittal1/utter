import { Switch } from "../../components/ui";
import { Group, Row, SettingsPage, WithSettings } from "./parts";

export default function System() {
  return (
    <SettingsPage title="System">
      <WithSettings>
        {(s, update) => (
          <>
            <Group title="App settings">
              <Row title="Launch app at login" description="Start Utter in the tray when you sign in to Windows.">
                <Switch label="Launch app at login" checked={s.launchAtLogin} onChange={(launchAtLogin) => void update({ launchAtLogin })} />
              </Row>
              <Row title="Show the pill at all times" description="Keep the small bar at the bottom of your screen, even when you aren't dictating.">
                <Switch label="Show the pill at all times" checked={s.showPill} onChange={(showPill) => void update({ showPill })} />
              </Row>
            </Group>
            <Group title="Sound">
              <Row title="Dictation sounds" description="A soft tick when recording starts and stops.">
                <Switch label="Dictation sounds" checked={s.sounds} onChange={(sounds) => void update({ sounds })} />
              </Row>
            </Group>
            <Group title="Microphone">
              <Row title="Keep microphone warm" description="Keeps the mic open so the first word is never clipped. Windows shows the mic as in use.">
                <Switch label="Keep microphone warm" checked={s.keepMicWarm} onChange={(keepMicWarm) => void update({ keepMicWarm })} />
              </Row>
            </Group>
          </>
        )}
      </WithSettings>
    </SettingsPage>
  );
}
