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

export type VoiceState = "idle" | "connecting" | "ready" | "listening" | "thinking" | "speaking" | "error" | "closed";

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
  private ready = false;   // connection ready (server sent "ready", auth accepted)
  private talking = false; // push-to-talk: true while the user's turn is active
  private closed = false;
  private levelThrottle = 0;

  constructor(
    private wsUrl: string,            // ws(s):// URL incl. ?tz= (no token — sent in-band)
    private token: string | null,     // JWT, sent as the first frame after open
    private cb: VoiceCallbacks = {},
    initialTranscript: TranscriptEntry[] = [], // prior history to seed the view
  ) {
    if (initialTranscript.length) this.transcript = [...initialTranscript];
  }

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
    this.inCtx = new AudioContext({ sampleRate: INPUT_RATE, latencyHint: "interactive" });
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
    this.outCtx = new AudioContext({ latencyHint: "interactive" });
    this.outGain = this.outCtx.createGain();
    this.outGain.connect(this.outCtx.destination);
    await this.resume();

    // ── WebSocket ──
    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      // Authenticate in-band as the very first frame — keeps the JWT out of the
      // URL (and therefore out of server access logs). Mic audio is withheld
      // until the server replies "ready", so this is always the first message.
      try { this.ws?.send(JSON.stringify({ type: "auth", token: this.token })); } catch {}
    };
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
    // Push-to-talk: only stream mic audio while the user's turn is active.
    if (!this.talking || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pending.push(new Int16Array(data.pcm));
    this.pendingLen += data.pcm.byteLength / 2;
    // Flush ~50 ms of audio at a time — small enough to keep input latency low,
    // large enough to avoid per-packet overhead.
    if (this.pendingLen >= INPUT_RATE / 20) {
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
          this.ready = true;
          this.setState("ready");
          this.playReadyChime();  // audible cue: connected, tap to talk
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
      if (this.sources.size === 0 && !this.closed && !this.talking) this.setState("ready");
    };
  }

  private stopPlayback() {
    for (const n of this.sources) { try { n.stop(); } catch {} }
    this.sources.clear();
    this.nextStart = 0;
    if (!this.closed && !this.talking) this.setState("ready");
  }

  /** A soft two-note chime the instant the connection is ready, so the user
   *  knows they can tap and talk — immediate and unobtrusive. */
  private playReadyChime() {
    const ctx = this.outCtx;
    if (!ctx) return;
    ctx.resume().catch(() => {});
    const dest = this.outGain ?? ctx.destination;
    const start = ctx.currentTime + 0.03;
    [523.25, 783.99].forEach((freq, i) => {  // C5 → G5: a friendly rising fifth
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = start + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.03);   // gentle attack
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30); // smooth release
      osc.connect(gain).connect(dest);
      osc.start(t);
      osc.stop(t + 0.34);
    });
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
  isTalking() { return this.talking; }

  /** Push-to-talk: begin the user's turn. Streams mic audio until endTurn(). */
  async startTurn() {
    if (!this.ready || this.closed || this.talking) return;
    await this.resume();
    this.stopPlayback();           // barge-in: cut any assistant playback
    this.pending = []; this.pendingLen = 0;
    this.talking = true;
    try { this.ws?.send(JSON.stringify({ type: "activity_start" })); } catch {}
    this.setState("listening");
  }

  /** Push-to-talk: end the user's turn — flush audio, signal end, await reply. */
  endTurn() {
    if (!this.talking) return;
    this.talking = false;
    // Flush any buffered mic audio so the tail of the turn isn't dropped.
    if (this.pendingLen && this.ws?.readyState === WebSocket.OPEN) {
      const merged = new Int16Array(this.pendingLen);
      let off = 0;
      for (const chunk of this.pending) { merged.set(chunk, off); off += chunk.length; }
      this.ws.send(merged.buffer);
    }
    this.pending = []; this.pendingLen = 0;
    try { this.ws?.send(JSON.stringify({ type: "activity_end" })); } catch {}
    this.setState("thinking");
  }

  /** Resume suspended AudioContexts (call on a user gesture to satisfy
   *  browser autoplay policies). */
  async resume() {
    await this.inCtx?.resume().catch(() => {});
    await this.outCtx?.resume().catch(() => {});
  }

  stop() {
    this.closed = true;
    this.ready = false;
    this.talking = false;
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
