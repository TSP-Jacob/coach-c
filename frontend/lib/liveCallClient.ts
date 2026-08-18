/**
 * LiveCallClient — browser side of the live call listen-in / takeover bridge.
 *
 * Mirrors lib/voiceClient.ts's WebSocket + Web Audio API approach (no
 * WebRTC/socket.io in this codebase), with two real differences: audio here
 * is 8 kHz (Twilio's rate, not Gemini's 24 kHz), and there are TWO
 * independent playback streams — the caller and whichever side (Francis or,
 * during a takeover, the admin) actually went out on the call — tagged by a
 * one-byte prefix so both can play back simultaneously.
 *
 * Binary frame format (matches the phone-agent server exactly):
 *   byte[0] = 0x00 caller audio | 0x01 agent audio (Francis or admin) — from
 *             server to browser, both @ 8 kHz PCM16LE.
 *   byte[0] = 0x02 admin mic audio — browser to server, @ 16 kHz PCM16LE
 *             (server resamples down before sending to Twilio), only sent
 *             while a takeover is actually active.
 *
 * Browser-only — instantiate from a client component after a user gesture.
 */

const OUTPUT_RATE = 8000;  // caller + agent audio arrive at Twilio's rate
const MIC_RATE = 16000;    // admin mic capture rate

const CALLER_TAG = 0x00;
const AGENT_TAG = 0x01;
const ADMIN_MIC_TAG = 0x02;

export type LiveCallState =
  | "idle" | "connecting" | "listening" | "takeover_active"
  | "error" | "ended" | "closed";

export interface LiveCallCallbacks {
  onState?: (s: LiveCallState) => void;
  onError?: (message: string) => void;
  onTakeoverDenied?: (reason: string) => void;
}

// Same worklet technique as voiceClient.ts — converts mic Float32 → Int16 PCM.
const WORKLET_SRC = `
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const buf = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ pcm: buf.buffer }, [buf.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

export class LiveCallClient {
  private ws: WebSocket | null = null;
  private outCtx: AudioContext | null = null;
  private outGain: GainNode | null = null;
  private inCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;

  // Two independent playback cursors so caller + agent audio play at once
  // instead of one blocking the other.
  private nextStartCaller = 0;
  private nextStartAgent = 0;
  private sourcesCaller = new Set<AudioBufferSourceNode>();
  private sourcesAgent = new Set<AudioBufferSourceNode>();

  private state: LiveCallState = "idle";
  private takeoverActive = false;
  private closed = false;

  constructor(
    private wsUrl: string,        // ws(s):// URL, e.g. `${wsBase()}/api/live-calls/${callSid}/stream`
    private token: string | null, // JWT, sent as the first frame after open
    private cb: LiveCallCallbacks = {},
  ) {}

  getState() { return this.state; }
  isTakeoverActive() { return this.takeoverActive; }

  private setState(s: LiveCallState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState?.(s);
  }

  async start() {
    if (this.state !== "idle") return;
    this.setState("connecting");

    this.outCtx = new AudioContext({ latencyHint: "interactive" });
    this.outGain = this.outCtx.createGain();
    this.outGain.connect(this.outCtx.destination);
    await this.outCtx.resume().catch(() => {});

    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      // Auth in-band as the first frame, same reasoning as voiceClient.ts —
      // keeps the JWT out of the URL and therefore out of access logs.
      try { this.ws?.send(JSON.stringify({ type: "auth", token: this.token })); } catch {}
    };
    this.ws.onmessage = (e) => this.onWsMessage(e);
    this.ws.onerror = () => { if (!this.closed) this.cb.onError?.("Connection error."); };
    this.ws.onclose = () => { if (!this.closed) this.setState("closed"); };
  }

  private onWsMessage(e: MessageEvent) {
    if (typeof e.data === "string") {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case "ready":
          this.setState("listening");
          break;
        case "takeover_ack":
          this.takeoverActive = true;
          this.setState("takeover_active");
          break;
        case "takeover_denied":
          this.cb.onTakeoverDenied?.(msg.reason || "Another admin is already handling this call.");
          break;
        case "call_ended":
          this.setState("ended");
          this.stop();
          break;
        case "error":
          this.cb.onError?.(msg.message || "Live call error.");
          this.setState("error");
          break;
      }
      return;
    }
    this.enqueueTaggedAudio(e.data as ArrayBuffer);
  }

  private enqueueTaggedAudio(buf: ArrayBuffer) {
    if (!this.outCtx || !this.outGain || buf.byteLength < 3) return;
    const tag = new Uint8Array(buf, 0, 1)[0];
    const pcm = new Int16Array(buf.slice(1));
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
    const audioBuf = this.outCtx.createBuffer(1, f32.length, OUTPUT_RATE);
    audioBuf.copyToChannel(f32, 0);

    const node = this.outCtx.createBufferSource();
    node.buffer = audioBuf;
    node.connect(this.outGain);

    const isCaller = tag === CALLER_TAG;
    const cursor = isCaller ? this.nextStartCaller : this.nextStartAgent;
    const sources = isCaller ? this.sourcesCaller : this.sourcesAgent;
    const start = Math.max(this.outCtx.currentTime, cursor);
    node.start(start);
    if (isCaller) this.nextStartCaller = start + audioBuf.duration;
    else this.nextStartAgent = start + audioBuf.duration;
    sources.add(node);
    node.onended = () => sources.delete(node);
  }

  /** Begin a takeover: acquires the mic (first time only — not needed just to
   *  listen), then asks the server. Actual mic streaming only starts once the
   *  server confirms with takeover_ack (see onMicFrame's guard). */
  async startTakeover() {
    if (this.closed || this.state !== "listening" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (!this.stream) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        this.cb.onError?.("Couldn't access the microphone to take over.");
        return;
      }
      this.inCtx = new AudioContext({ sampleRate: MIC_RATE, latencyHint: "interactive" });
      const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
      await this.inCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      const src = this.inCtx.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.inCtx, "pcm-worklet");
      this.worklet.port.onmessage = (e) => this.onMicFrame(e.data);
      src.connect(this.worklet);
      // Worklet must be in the graph to run; route to a muted node so it's
      // never actually heard locally (only streamed to the server).
      const sink = this.inCtx.createGain();
      sink.gain.value = 0;
      this.worklet.connect(sink).connect(this.inCtx.destination);
    }
    await this.inCtx?.resume().catch(() => {});
    this.ws.send(JSON.stringify({ type: "takeover_start" }));
  }

  private onMicFrame(data: { pcm: ArrayBuffer }) {
    // Only actually stream once the server has confirmed the takeover lock —
    // no explicit turn concept here, mic just flows continuously while active.
    if (!this.takeoverActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const tagged = new Uint8Array(1 + data.pcm.byteLength);
    tagged[0] = ADMIN_MIC_TAG;
    tagged.set(new Uint8Array(data.pcm), 1);
    this.ws.send(tagged.buffer);
  }

  /** Ends the underlying call (only meaningful once takeover is active — the
   *  server ignores this from a socket that isn't the takeover owner). */
  endCall() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "end_call" }));
  }

  stop() {
    this.closed = true;
    try { this.ws?.close(); } catch {}
    for (const n of this.sourcesCaller) { try { n.stop(); } catch {} }
    for (const n of this.sourcesAgent) { try { n.stop(); } catch {} }
    this.sourcesCaller.clear();
    this.sourcesAgent.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.worklet?.disconnect();
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    if (this.state !== "ended") this.setState("closed");
  }
}
