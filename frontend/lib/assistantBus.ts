// Tiny event bus so pages outside FloatingAssistant (e.g. Tasks) can open the
// global voice/chat panel programmatically — voice is the default way to
// create things like tasks, and the panel already lives in AppShell.
const OPEN_EVENT = "coachc:open-assistant";

export function openVoiceAssistant() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_EVENT));
  }
}

export function onOpenVoiceAssistant(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
