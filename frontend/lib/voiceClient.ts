/**
 * VoiceSession — browser side of the live voice assistant.
 *
 * Captures mic audio (16 kHz PCM16), streams it to the backend voice
 * WebSocket, plays back the assistant's audio (24 kHz PCM16) with gapless
 * scheduling + barge-in interruption, and maintains a running transcript of
 * both sides so the UI can show the conversation "in writing" while it speaks.
 *
 * Browser-only — instantiate from client components after a user gesture.
 */

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error" | "closed";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface VoiceCallbacks {
  onState?: (s: VoiceState) => void;
  onTranscript?: (entries: TranscriptEntry[]) => void;
  onLevel?: (level: number) => void; // mic input level 0..1
  onError?: (message: string) => void;
}

// Worklet that converts mic Float32 → Int16 PCM and reports input level.
const WORKLET_SRC = `
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const buf = new Int16Array(ch.length);
      let sum = 0;
      for (let i = 0; i < ch.length; i++) {
        let s = Math.max(-1, Math.min(1, ch[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        sum += s * s;
      }
      this.port.postMessage({ pcm: buf.buffer, level: Math.sqrt(sum / ch.length) }, [buf.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

export class VoiceSession {
  private ws: WebSocket | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private outGain: GainNode | null = null;

  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private pending: Int16Array[] = []; // outgoing mic batching
  private pendingLen = 0;

  private transcript: TranscriptEntry[] = [];
  private state: VoiceState = "idle";
  private muted = false;
  private closed = false;
  private levelThrottle = 0;

  constructor(
    private wsUrl: string,       // full ws(s):// URL incl. ?token=&tz=
    private cb: VoiceCallbacks = {},
  ) {}

  getTranscript() { return this.transcript; }
  isMuted() { return this.muted; }

  private setState(s: VoiceState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState?.(s);
  }

  private emitTranscript() { this.cb.onTranscript?.([...this.transcript]); }

  private openEntry(role: "user" | "assistant"): TranscriptEntry {
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.role === role && (last as any)._open) return last;
    if (last) delete (last as any)._open;
    const entry: TranscriptEntry & { _open?: boolean } = { role, text: "" };
    entry._open = true;
    this.transcript.push(entry);
    return entry;
  }

  private closeEntries() {
    for (const e of this.transcript) delete (e as any)._open;
  }

  async start() {
    if (this.state !== "idle") return;
    this.setState("connecting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.cb.onError?.("Microphone access was blocked. Enable it to talk to the assistant.");
      this.setState("error");
      return;
    }

    // ── Mic capture at 16 kHz ──
    this.inCtx = new AudioContext({ sampleRate: INPUT_RATE });
    const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    await this.inCtx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);
    const src = this.inCtx.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.inCtx, "pcm-worklet");
    this.worklet.port.onmessage = (e) => this.onMicFrame(e.data);
    src.connect(this.worklet);
    // Worklet must be in the graph to run; route to a muted node.
    const sink = this.inCtx.createGain();
    sink.gain.value = 0;
    this.worklet.connect(sink).connect(this.inCtx.destination);

    // ── Playback context ──
    this.outCtx = new AudioContext();
    this.outGain = this.outCtx.createGain();
    this.outGain.connect(this.outCtx.destination);
    await this.resume();

    // ── WebSocket ──
    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (e) => this.onWsMessage(e);
    this.ws.onerror = () => { if (!this.closed) this.cb.onError?.("Connection error."); };
    this.ws.onclose = () => { if (!this.closed) this.setState("closed"); };
  }

  private onMicFrame(data: { pcm: ArrayBuffer; level: number }) {
    // level meter (throttled)
    const now = performance.now();
    if (now - this.levelThrottle > 60) {
      this.levelThrottle = now;
      this.cb.onLevel?.(Math.min(1, data.level * 4));
    }
    if (this.muted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Batch ~100 ms of audio before sending to cut message overhead.
    this.pending.push(new Int16Array(data.pcm));
    this.pendingLen += data.pcm.byteLength / 2;
    if (this.pendingLen >= INPUT_RATE / 10) {
      const merged = new Int16Array(this.pendingLen);
      let off = 0;
      for (const chunk of this.pending) { merged.set(chunk, off); off += chunk.length; }
      this.pending = [];
      this.pendingLen = 0;
      this.ws.send(merged.buffer);
    }
  }

  private onWsMessage(e: MessageEvent) {
    if (typeof e.data === "string") {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case "ready":
          this.setState("listening");
          break;
        case "input_transcript":
          this.openEntry("user").text += msg.text;
          this.emitTranscript();
          break;
        case "output_transcript":
          this.openEntry("assistant").text += msg.text;
          this.emitTranscript();
          break;
        case "turn_complete":
          this.closeEntries();
          this.emitTranscript();
          break;
        case "interrupted":
          this.stopPlayback();
          break;
        case "error":
          this.cb.onError?.(msg.message || "Voice error.");
          this.setState("error");
          break;
      }
      return;
    }
    // Binary → assistant audio
    this.enqueueAudio(e.data as ArrayBuffer);
  }

  private enqueueAudio(buf: ArrayBuffer) {
    if (!this.outCtx || !this.outGain) return;
    const pcm = new Int16Array(buf);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
    const audioBuf = this.outCtx.createBuffer(1, f32.length, OUTPUT_RATE);
    audioBuf.copyToChannel(f32, 0);

    const node = this.outCtx.createBufferSource();
    node.buffer = audioBuf;
    node.connect(this.outGain);
    const start = Math.max(this.outCtx.currentTime, this.nextStart);
    node.start(start);
    this.nextStart = start + audioBuf.duration;
    this.setState("speaking");
    this.sources.add(node);
    node.onended = () => {
      this.sources.delete(node);
      if (this.sources.size === 0 && !this.closed) this.setState("listening");
    };
  }

  private stopPlayback() {
    for (const n of this.sources) { try { n.stop(); } catch {} }
    this.sources.clear();
    this.nextStart = 0;
    if (!this.closed) this.setState("listening");
  }

  /** Send a typed message instead of speaking. */
  sendText(text: string) {
    const t = text.trim();
    if (!t || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.closeEntries();
    this.transcript.push({ role: "user", text: t });
    this.emitTranscript();
    this.ws.send(JSON.stringify({ type: "text", text: t }));
  }

  setMuted(m: boolean) { this.muted = m; }

  /** Resume suspended AudioContexts (call on a user gesture to satisfy
   *  browser autoplay policies). */
  async resume() {
    await this.inCtx?.resume().catch(() => {});
    await this.outCtx?.resume().catch(() => {});
  }

  stop() {
    this.closed = true;
    try { this.ws?.send(JSON.stringify({ type: "end" })); } catch {}
    try { this.ws?.close(); } catch {}
    this.stopPlayback();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.worklet?.disconnect();
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    this.setState("closed");
  }
}
