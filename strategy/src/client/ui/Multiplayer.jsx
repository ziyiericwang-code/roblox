// Multiplayer screens (wired to the campaign server in net/Online.js).
import { store } from '../state/store.js';

export function MultiplayerScreen() {
  return (
    <div class="title-screen">
      <div class="title-card">
        <h2>Multiplayer</h2>
        <p class="muted">Connecting to the campaign server…</p>
        <button class="big" onClick={() => store.set({ screen: 'title' })}>Back</button>
      </div>
    </div>
  );
}
export function LobbyScreen() {
  return null;
}
