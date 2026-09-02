// Resamples the microphone to the 16 kHz PCM16 the Gemini Live API expects.
//
// Shipped as a real asset rather than a blob: URL — the app's CSP allows scripts
// from 'self' only, and a worklet loaded from a blob is refused outright.
class CaptionDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.ratio = sampleRate / (options.processorOptions?.targetRate || 16000)
    this.position = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true

    const frames = []
    // Nearest-sample decimation, carrying the fractional position across blocks
    // so the stream does not drift. Speech recognition tolerates the aliasing
    // this leaves behind, and a proper filter would cost latency.
    for (; this.position < channel.length; this.position += this.ratio) {
      const sample = channel[Math.floor(this.position)]
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
      frames.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
    }
    this.position -= channel.length

    if (frames.length) {
      const out = new Int16Array(frames)
      this.port.postMessage(out.buffer, [out.buffer])
    }
    return true
  }
}

registerProcessor('caption-downsampler', CaptionDownsampler)
